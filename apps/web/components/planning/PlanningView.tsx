"use client";

import { type ReactNode, useEffect, useRef } from "react";
import Link from "next/link";
import { ChatMessage } from "@/components/nexui/chat-message";
import { PromptInput } from "@/components/nexui/prompt-input";
import { StreamingText } from "@/components/nexui/streaming-text";
import { ThinkingIndicator } from "@/components/nexui/thinking-indicator";
import { Button } from "@/components/nexui/button";
import {
  ReviewGate,
  type ReviewDecision,
  type ReviewState,
} from "@/components/nexui/review-gate";
import YugnexLogo from "../ide/YugnexLogo";
import { planning as s } from "./planning.styles";

export interface PlanningChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PlanningViewProps {
  projectId: string;
  projectName: string;

  messages: PlanningChatMessage[];
  streamingMessage: string;
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: (value: string) => void;

  /** Slides in above the composer when the planner needs a specific answer. */
  elicitation?: ReactNode;
  /** Disables the composer while a question is pending — the answer is the reply. */
  composerDisabled?: boolean;

  /** The spec, once there is one to show. */
  plan?: ReactNode;
  /** True while the plan is still being written, which drives the live chrome. */
  planStreaming?: boolean;

  /**
   * Present only once a plan is complete enough to decide on. The gate is what
   * makes this a decision point rather than a preview.
   */
  review?: {
    state: ReviewState;
    onDecide: (decision: ReviewDecision) => void;
    onClear: (scope: "document" | "section" | "file" | "hunk", id: string) => void;
  };
}

export default function PlanningView({
  projectId,
  projectName,
  messages,
  streamingMessage,
  loading,
  input,
  onInputChange,
  onSend,
  elicitation,
  composerDisabled = false,
  plan,
  planStreaming = false,
  review,
}: PlanningViewProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingMessage, loading]);

  const hasPlan = Boolean(plan);

  return (
    <div className={s.root}>
      <nav className={s.rail}>
        <Link href="/dashboard" className={s.railBrand}>
          <YugnexLogo size={18} />
          YugNex
        </Link>
        <span className={s.railSep}>/</span>
        <span className={s.railProject}>{projectName || projectId}</span>
        <div className={s.railSpacer} />
        <span className={s.phaseChip}>
          <span className={s.phaseDot} />
          Planning
        </span>
      </nav>

      <div className={s.body}>
        {/* ── Conversation ─────────────────────────────────────────── */}
        <section className={`${s.pane} ${s.paneLeft}`}>
          <header className={s.paneHead}>
            <span className={s.paneHeadLabel}>Conversation</span>
          </header>

          <div className={s.thread}>
            {messages.length === 0 && !streamingMessage && !loading ? (
              <div className={s.opening}>
                <div className={s.openingTitle}>What are we building?</div>
                <p className={s.openingBody}>
                  Describe it in your own words. I&apos;ll ask only what I actually need, then
                  write the spec on the right as we go.
                </p>
              </div>
            ) : (
              messages.map((m, i) => (
                <ChatMessage key={i} role={m.role}>
                  {m.content}
                </ChatMessage>
              ))
            )}

            {(streamingMessage || loading) && (
              <ChatMessage role="assistant">
                {streamingMessage ? (
                  <StreamingText text={streamingMessage} charsPerSecond={220} />
                ) : (
                  <ThinkingIndicator label="Thinking" />
                )}
              </ChatMessage>
            )}

            <div ref={endRef} />
          </div>

          <div className={s.composer}>
            {elicitation && <div className={s.elicitation}>{elicitation}</div>}
            <PromptInput
              value={input}
              onValueChange={onInputChange}
              onSubmit={onSend}
              isLoading={loading}
              disabled={composerDisabled}
              minRows={2}
              placeholder={
                composerDisabled
                  ? "Pick an option above to continue…"
                  : "Describe your app…"
              }
              actions={
                <Button
                  size="sm"
                  onClick={() => onSend(input)}
                  disabled={loading || composerDisabled || !input.trim()}
                >
                  Send
                </Button>
              }
            />
          </div>
        </section>

        {/* ── Specification ────────────────────────────────────────── */}
        <section className={`${s.pane} ${s.paneRight}`}>
          <header className={s.paneHead}>
            {planStreaming && <span className={s.paneHeadScan} aria-hidden="true" />}
            <span className={s.paneHeadLabel}>Specification</span>
            <div className={s.railSpacer} />
            {planStreaming && (
              <span className={s.liveTag}>
                <span className={s.liveTagDot} />
                Writing
              </span>
            )}
          </header>

          <div className={s.planScroll}>
            {hasPlan ? (
              plan
            ) : (
              <div className={s.awaiting} aria-label="Waiting for the specification">
                {[92, 68, 80, 44, 88, 60, 74, 38].map((w, i) => (
                  <div key={i} className={s.awaitingRow} style={{ width: `${w}%` }} />
                ))}
                <div className={s.awaitingNote}>
                  The spec fills in here as we talk — pages, data model, API surface, and the
                  design direction.
                </div>
              </div>
            )}
          </div>

          {review && hasPlan && (
            <div className={s.gateBar}>
              <ReviewGate
                scope="document"
                id="plan"
                label="Build plan"
                value={review.state}
                onDecide={review.onDecide}
                onClear={review.onClear}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
