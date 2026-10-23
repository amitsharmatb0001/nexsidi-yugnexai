// A model provider refusing a request under its terms of use (2026-10-23). On 2026-10-22 Google answered every request
// with 403 "Request rejected in accordance with our terms of use and policies"; the system resent the refused request to
// every other model, called the result quota exhaustion, and waited up to 2 hours. A refusal is not a limit that clears
// with time: the request is sent nowhere else, the step stops, and the owner is told the provider refused it.

export function isProviderRefusal(error: string): boolean {
  return /terms of use and polic/i.test(error) || (/\b403\b/.test(error) && /rejected in accordance/i.test(error));
}

export class ProviderRefusalError extends Error {
  constructor(detail: string) {
    super(`[llm-client] The model provider refused this request under its terms of use; it was not sent to any other model. ${detail.slice(0, 300)}`);
    this.name = "ProviderRefusalError";
  }
}
