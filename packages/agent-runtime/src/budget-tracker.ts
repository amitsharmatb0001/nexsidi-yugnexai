export class BudgetTracker {
  private inputTokensUsed = 0;
  private outputTokensUsed = 0;
  private requestCount = 0;

  // Defaults: 500,000 input tokens max, 100,000 output tokens max per run
  private inputBudget = 500000;
  private outputBudget = 100000;

  public getTotals(): { input: number; output: number; requests: number } {
    return { input: this.inputTokensUsed, output: this.outputTokensUsed, requests: this.requestCount };
  }

  public recordRequest(promptTokens: number, completionTokens: number): void {
    this.requestCount++;
    this.inputTokensUsed += promptTokens;
    this.outputTokensUsed += completionTokens;

    console.log(
      `[budget] Request #${this.requestCount}: input=${promptTokens} tokens, output=${completionTokens} tokens.`,
    );
    console.log(
      `[budget] Cumulative totals: input=${this.inputTokensUsed}/${this.inputBudget} (${Math.round(
        (this.inputTokensUsed / this.inputBudget) * 100,
      )}%), output=${this.outputTokensUsed}/${this.outputBudget} (${Math.round(
        (this.outputTokensUsed / this.outputBudget) * 100,
      )}%).`,
    );

    if (this.inputTokensUsed >= this.inputBudget * 0.85) {
      console.warn(
        `[budget] Proactive warning: input token usage is at ${Math.round(
          (this.inputTokensUsed / this.inputBudget) * 100,
        )}% of rate limit budget!`,
      );
    }
    if (this.outputTokensUsed >= this.outputBudget * 0.85) {
      console.warn(
        `[budget] Proactive warning: output token usage is at ${Math.round(
          (this.outputTokensUsed / this.outputBudget) * 100,
        )}% of rate limit budget!`,
      );
    }
  }

}
