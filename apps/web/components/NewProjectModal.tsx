"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from "@/components/nexui/modal";
import { Input } from "@/components/nexui/input";
import { Textarea } from "@/components/nexui/textarea";
import { Button } from "@/components/nexui/button";
import { css, themeVars as theme } from "@yugnex/core";
import { ground } from "@/lib/design";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const field = css({ display: "flex", flexDirection: "column", gap: theme.space[1.5], marginBottom: theme.space[3] });
const label = css({
  fontSize: "11px",
  fontWeight: theme.fontWeight.medium,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: theme.color.mutedForeground,
});
const errorText = css({ fontSize: "12px", color: theme.color.destructive, marginTop: theme.space[1] });
const hint = css({ fontSize: "11.5px", color: theme.color.mutedForeground, lineHeight: 1.5, marginTop: "-4px", marginBottom: theme.space[3] });

/**
 * The real entry point for a new project — a project row is created
 * immediately (POST /api/projects), with a real name and its founding
 * context, before anything else happens. Replaces the previous flow, where
 * "New project" only generated a client-side id and navigated to a page
 * with no database row behind it at all: nothing appeared in the project
 * list, and the name existed nowhere, until the planner conversation
 * finished and called trigger_build. An abandoned mid-chat attempt left no
 * trace anywhere.
 *
 * Creation only creates the row — it does not send anything to the planner.
 * The context typed here is saved as the project's Context (durable
 * reference material, editable later in the Context panel), not as a chat
 * message. The user opens the project and starts the conversation
 * themselves; an earlier version auto-sent the context as the first chat
 * message via a ?q= redirect, which meant a project's chat log always
 * began with something the user never actually said to it.
 */
export default function NewProjectModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setContext("");
    setError(null);
    setSubmitting(false);
  };

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
    reset();
  };

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedContext = context.trim();
    if (!trimmedName) return setError("Give the project a name.");
    if (!trimmedContext) return setError("Describe what you want built.");

    setSubmitting(true);
    setError(null);
    try {
      const createRes = await fetch(`${API}/api/projects`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmedName, context: trimmedContext }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => null);
        setError(body?.error === "context_too_long" ? "That's a bit long — trim it down." : "Couldn't create the project.");
        setSubmitting(false);
        return;
      }
      const { id } = (await createRes.json()) as { id: string };

      onOpenChange(false);
      reset();
      router.push(`/build/${id}`);
    } catch {
      setError("Couldn't reach the server. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onOpenChange={close}>
      <ModalContent style={{ backgroundColor: ground.panel }}>
        <ModalHeader>
          <ModalTitle>New project</ModalTitle>
          <ModalDescription>
            Name it and describe what you want built — this becomes the project&apos;s own context, kept
            separate from every other project.
          </ModalDescription>
        </ModalHeader>

        <div className={field}>
          <label className={label} htmlFor="np-name">Project name</label>
          <Input
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client portfolio site"
            maxLength={200}
            disabled={submitting}
          />
        </div>

        <div className={field} style={{ marginBottom: 0 }}>
          <label className={label} htmlFor="np-context">What are you building?</label>
          <Textarea
            id="np-context"
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Describe the app, who it's for, and anything you already know you want in it…"
            rows={5}
            maxLength={8000}
            disabled={submitting}
          />
        </div>
        <p className={hint}>Saved as this project&apos;s context — you&apos;ll start the conversation yourself once it opens.</p>

        {error && <p className={errorText}>{error}</p>}

        <ModalFooter>
          <Button variant="ghost" onClick={close} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
