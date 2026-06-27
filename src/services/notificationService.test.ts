import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  notificationService,
  _resetNotificationMemory,
  _getNotificationMemory,
  type CreateNotificationInput,
} from "./notificationService.js";

describe("notificationService", () => {
  beforeEach(() => {
    _resetNotificationMemory();
  });

  afterEach(() => {
    _resetNotificationMemory();
    vi.restoreAllMocks();
  });

  describe("create", () => {
    it("should create notification and return id", async () => {
      const input: CreateNotificationInput = {
        category: "payment_due",
        title: "Payment Due",
        body: "Your rent payment is due",
      };

      const id = await notificationService.create("user-1", input);

      expect(id).toBeDefined();
      expect(typeof id).toBe("string");

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(1);
      expect(memory[0]?.userId).toBe("user-1");
      expect(memory[0]?.title).toBe("Payment Due");
    });

    it("should deduplicate by dedupe key", async () => {
      const input: CreateNotificationInput = {
        category: "payment_reminder",
        title: "Payment Reminder",
        body: "Reminder about payment",
        dedupeKey: "payment-due-user1-2024-01",
      };

      const id1 = await notificationService.create("user-1", input);
      const id2 = await notificationService.create("user-1", input);

      expect(id1).toBe(id2);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(1);
    });

    it("should allow different users with same dedupe key", async () => {
      const input: CreateNotificationInput = {
        category: "payment_reminder",
        title: "Payment Reminder",
        body: "Reminder",
        dedupeKey: "payment-due-2024-01",
      };

      const id1 = await notificationService.create("user-1", input);
      const id2 = await notificationService.create("user-2", input);

      expect(id1).not.toBe(id2);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(2);
    });

    it("should store notification with data payload", async () => {
      const input: CreateNotificationInput = {
        category: "deal_update",
        title: "Deal Updated",
        body: "Your deal has been updated",
        data: {
          dealId: "deal-123",
          status: "active",
          amount: 50000,
        },
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.data).toEqual({
        dealId: "deal-123",
        status: "active",
        amount: 50000,
      });
    });

    it("should handle notification without data", async () => {
      const input: CreateNotificationInput = {
        category: "general",
        title: "General Notification",
        body: "General message",
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.data).toBeNull();
    });

    it("should set createdAt timestamp", async () => {
      const beforeCreate = new Date();

      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test body",
      };

      await notificationService.create("user-1", input);

      const afterCreate = new Date();
      const memory = _getNotificationMemory();

      const createdAt = new Date(memory[0]!.createdAt);
      expect(createdAt.getTime()).toBeGreaterThanOrEqual(
        beforeCreate.getTime(),
      );
      expect(createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });

    it("should initialize readAt as null", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test body",
      };

      await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      expect(memory[0]?.readAt).toBeNull();
    });

    it("should handle multiple notifications for same user", async () => {
      const inputs: CreateNotificationInput[] = [
        { category: "payment_due", title: "Payment 1", body: "Body 1" },
        { category: "payment_due", title: "Payment 2", body: "Body 2" },
        { category: "deal_update", title: "Deal Update", body: "Body 3" },
      ];

      for (const input of inputs) {
        await notificationService.create("user-1", input);
      }

      const memory = _getNotificationMemory();
      const userNotifications = memory.filter((n) => n.userId === "user-1");

      expect(userNotifications).toHaveLength(3);
    });

    it("should isolate notifications by user", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test body",
      };

      await notificationService.create("user-1", input);
      await notificationService.create("user-2", input);
      await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const user1Notifications = memory.filter((n) => n.userId === "user-1");
      const user2Notifications = memory.filter((n) => n.userId === "user-2");

      expect(user1Notifications).toHaveLength(2);
      expect(user2Notifications).toHaveLength(1);
    });
  });

  describe("deduplication", () => {
    it("should be idempotent with dedupe key", async () => {
      const input: CreateNotificationInput = {
        category: "late_payment_warning",
        title: "Late Payment",
        body: "Your payment is late",
        dedupeKey: "late-payment-user1-deal123-2024-01",
      };

      const id1 = await notificationService.create("user-1", input);
      const id2 = await notificationService.create("user-1", input);
      const id3 = await notificationService.create("user-1", input);

      expect(id1).toBe(id2);
      expect(id2).toBe(id3);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(1);
    });

    it("should not deduplicate without dedupe key", async () => {
      const input: CreateNotificationInput = {
        category: "general",
        title: "General",
        body: "General notification",
      };

      const id1 = await notificationService.create("user-1", input);
      const id2 = await notificationService.create("user-1", input);

      expect(id1).not.toBe(id2);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(2);
    });

    it("should scope deduplication per user", async () => {
      const input: CreateNotificationInput = {
        category: "payment_due",
        title: "Payment Due",
        body: "Payment due notification",
        dedupeKey: "payment-due-jan-2024",
      };

      const id1 = await notificationService.create("user-1", input);
      const id2 = await notificationService.create("user-2", input);
      const id3 = await notificationService.create("user-1", input);

      expect(id1).toBe(id3);
      expect(id1).not.toBe(id2);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(2);
    });

    it("should handle different dedupe keys for same user", async () => {
      const input1: CreateNotificationInput = {
        category: "payment",
        title: "Payment 1",
        body: "Body 1",
        dedupeKey: "key-1",
      };

      const input2: CreateNotificationInput = {
        category: "payment",
        title: "Payment 2",
        body: "Body 2",
        dedupeKey: "key-2",
      };

      const id1 = await notificationService.create("user-1", input1);
      const id2 = await notificationService.create("user-1", input2);

      expect(id1).not.toBe(id2);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(2);
    });
  });

  describe("notification memory management", () => {
    it("should reset memory correctly", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test",
      };

      await notificationService.create("user-1", input);
      await notificationService.create("user-2", input);

      expect(_getNotificationMemory()).toHaveLength(2);

      _resetNotificationMemory();

      expect(_getNotificationMemory()).toHaveLength(0);
    });

    it("should allow recreation after reset", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test",
        dedupeKey: "test-key",
      };

      const id1 = await notificationService.create("user-1", input);

      _resetNotificationMemory();

      const id2 = await notificationService.create("user-1", input);

      expect(id1).not.toBe(id2);
    });
  });

  describe("category handling", () => {
    it("should store different notification categories", async () => {
      const categories = [
        "payment_due",
        "payment_received",
        "deal_status_changed",
        "kyc_approved",
        "document_requested",
      ];

      for (const category of categories) {
        await notificationService.create("user-1", {
          category,
          title: `${category} title`,
          body: `${category} body`,
        });
      }

      const memory = _getNotificationMemory();
      const storedCategories = memory.map((n) => n.category);

      expect(storedCategories).toEqual(categories);
    });
  });

  describe("concurrent notifications", () => {
    it("should handle concurrent creates without collision", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test",
      };

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(notificationService.create(`user-${i}`, input));
      }

      const ids = await Promise.all(promises);

      expect(new Set(ids).size).toBe(10);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(10);
    });

    it("should deduplicate concurrent calls with same dedupe key", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test",
        dedupeKey: "concurrent-test",
      };

      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(notificationService.create("user-1", input));
      }

      const ids = await Promise.all(promises);

      expect(new Set(ids).size).toBe(1);

      const memory = _getNotificationMemory();
      expect(memory).toHaveLength(1);
    });
  });

  describe("data payload validation", () => {
    it("should handle complex nested data", async () => {
      const input: CreateNotificationInput = {
        category: "complex",
        title: "Complex",
        body: "Complex data",
        data: {
          user: {
            id: "user-1",
            name: "Test User",
          },
          deal: {
            id: "deal-1",
            amount: 50000,
            status: "active",
          },
          metadata: {
            timestamp: new Date().toISOString(),
            source: "automated",
          },
        },
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.data).toEqual(input.data);
    });

    it("should handle array data", async () => {
      const input: CreateNotificationInput = {
        category: "list",
        title: "List",
        body: "List data",
        data: {
          items: ["item1", "item2", "item3"],
          counts: [1, 2, 3],
        },
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.data).toEqual(input.data);
    });
  });

  describe("notification ordering", () => {
    it("should maintain creation order", async () => {
      const titles = ["First", "Second", "Third", "Fourth"];

      for (const title of titles) {
        await notificationService.create("user-1", {
          category: "test",
          title,
          body: `${title} body`,
        });
      }

      const memory = _getNotificationMemory();
      const storedTitles = memory.map((n) => n.title);

      expect(storedTitles).toEqual(titles);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string title and body", async () => {
      const input: CreateNotificationInput = {
        category: "empty",
        title: "",
        body: "",
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.title).toBe("");
      expect(notification?.body).toBe("");
    });

    it("should handle very long text", async () => {
      const longText = "a".repeat(10000);

      const input: CreateNotificationInput = {
        category: "long",
        title: longText,
        body: longText,
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.title).toBe(longText);
      expect(notification?.body).toBe(longText);
    });

    it("should handle special characters in content", async () => {
      const specialText = "!@#$%^&*()_+-=[]{}|;:,.<>?/~`";

      const input: CreateNotificationInput = {
        category: "special",
        title: specialText,
        body: specialText,
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.title).toBe(specialText);
    });

    it("should handle unicode characters", async () => {
      const unicodeText = "你好世界 🎉 مرحبا 🌍";

      const input: CreateNotificationInput = {
        category: "unicode",
        title: unicodeText,
        body: unicodeText,
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.title).toBe(unicodeText);
    });

    it("should handle null data value explicitly", async () => {
      const input: CreateNotificationInput = {
        category: "test",
        title: "Test",
        body: "Test",
        data: undefined,
      };

      const id = await notificationService.create("user-1", input);

      const memory = _getNotificationMemory();
      const notification = memory.find((n) => n.id === id);

      expect(notification?.data).toBeNull();
    });
  });
});
