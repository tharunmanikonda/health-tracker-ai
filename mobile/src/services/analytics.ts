type AnalyticsValue = string | number | boolean | null | undefined;
type AnalyticsPayload = Record<string, AnalyticsValue>;

interface AnalyticsEvent {
  event: string;
  timestamp: string;
  payload: AnalyticsPayload;
}

class AnalyticsService {
  private sessionId: string;

  constructor() {
    this.sessionId = `session_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  track(event: string, payload: AnalyticsPayload = {}): void {
    const entry: AnalyticsEvent = {
      event,
      timestamp: new Date().toISOString(),
      payload: {
        session_id: this.sessionId,
        ...payload,
      },
    };

    // TODO: ship this queue to backend analytics endpoint when available.
    console.log('[Analytics]', JSON.stringify(entry));
  }
}

export const analyticsService = new AnalyticsService();

