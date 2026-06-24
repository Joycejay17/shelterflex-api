import { describe, it, expect, beforeEach } from 'vitest'
import { metricsRegister } from './metrics.js'
import {
  outboxPendingGauge,
  outboxProcessedTotal,
  outboxFailedTotal,
  outboxProcessingDurationMs,
  settlementPendingGauge,
  settlementProcessedTotal,
  settlementFailedTotal,
  settlementProcessingDurationMs,
  reconciliationPendingGauge,
  reconciliationProcessedTotal,
  reconciliationMismatchesTotal,
  reconciliationProcessingDurationMs,
} from './metrics.js'

describe('Metrics registration', () => {
  it('should register outbox metrics', async () => {
    const metrics = await metricsRegister.getMetricsAsJSON()
    const metricNames = metrics.map((m: any) => m.name)

    expect(metricNames).toContain('outbox_pending_count')
    expect(metricNames).toContain('outbox_processed_total')
    expect(metricNames).toContain('outbox_failed_total')
    expect(metricNames).toContain('outbox_processing_duration_ms')
  })

  it('should register settlement metrics', async () => {
    const metrics = await metricsRegister.getMetricsAsJSON()
    const metricNames = metrics.map((m: any) => m.name)

    expect(metricNames).toContain('settlement_pending_count')
    expect(metricNames).toContain('settlement_processed_total')
    expect(metricNames).toContain('settlement_failed_total')
    expect(metricNames).toContain('settlement_processing_duration_ms')
  })

  it('should register reconciliation metrics', async () => {
    const metrics = await metricsRegister.getMetricsAsJSON()
    const metricNames = metrics.map((m: any) => m.name)

    expect(metricNames).toContain('reconciliation_pending_count')
    expect(metricNames).toContain('reconciliation_processed_total')
    expect(metricNames).toContain('reconciliation_mismatches_total')
    expect(metricNames).toContain('reconciliation_processing_duration_ms')
  })

  it('should have correct metric types', async () => {
    const metrics = await metricsRegister.getMetricsAsJSON()
    const metricsMap = new Map(metrics.map((m: any) => [m.name, m.type]))

    expect(metricsMap.get('outbox_pending_count')).toBe('gauge')
    expect(metricsMap.get('outbox_processed_total')).toBe('counter')
    expect(metricsMap.get('outbox_failed_total')).toBe('counter')
    expect(metricsMap.get('outbox_processing_duration_ms')).toBe('histogram')

    expect(metricsMap.get('settlement_pending_count')).toBe('gauge')
    expect(metricsMap.get('settlement_processed_total')).toBe('counter')
    expect(metricsMap.get('settlement_failed_total')).toBe('counter')
    expect(metricsMap.get('settlement_processing_duration_ms')).toBe('histogram')

    expect(metricsMap.get('reconciliation_pending_count')).toBe('gauge')
    expect(metricsMap.get('reconciliation_processed_total')).toBe('counter')
    expect(metricsMap.get('reconciliation_mismatches_total')).toBe('counter')
    expect(metricsMap.get('reconciliation_processing_duration_ms')).toBe('histogram')
  })

  it('should have correct labels on labeled metrics', async () => {
    const metrics = await metricsRegister.getMetricsAsJSON()
    const metricsMap = new Map(metrics.map((m: any) => [m.name, m]))

    const outboxProcessed = metricsMap.get('outbox_processed_total')
    expect(outboxProcessed?.help).toContain('outbox')

    const outboxFailed = metricsMap.get('outbox_failed_total')
    expect(outboxFailed?.help).toContain('dead-lettered')

    const settlementProcessed = metricsMap.get('settlement_processed_total')
    expect(settlementProcessed?.help).toContain('settlement')

    const settlementFailed = metricsMap.get('settlement_failed_total')
    expect(settlementFailed?.help).toContain('dead-lettered')

    const reconciliationProcessed = metricsMap.get('reconciliation_processed_total')
    expect(reconciliationProcessed?.help).toContain('reconciliation')

    const reconciliationMismatches = metricsMap.get('reconciliation_mismatches_total')
    expect(reconciliationMismatches?.help).toContain('mismatch')
  })
})
