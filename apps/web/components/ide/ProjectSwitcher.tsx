"use client";

// The IDE's own way in/out of the project list, so opening a different
// project or starting a new one doesn't require leaving the workspace first
// — the third piece of the same request that moved project creation to a
// real name+context form: create, open, and switch all reachable from
// inside the IDE itself.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/nexui/dropdown-menu";
import NewProjectModal from "../NewProjectModal";
import { IconChevronDown } from "./IdeIcons";
import { ws as s } from "./IdeWorkspace.styles";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

interface SwitcherProject {
  id: string;
  name: string;
  status: string;
}

export default function ProjectSwitcher({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [projects, setProjects] = useState<SwitcherProject[] | null>(null);

  useEffect(() => {
    if (!open || projects) return;
    fetch(`${API}/api/projects`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setProjects(j.projects ?? []); })
      .catch(() => {});
  }, [open, projects]);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger>
          <button type="button" className={s.projectSwitcherBtn}>
            <span className={s.projectName}>{projectName}</span>
            <IconChevronDown size={12} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className={s.projectSwitcherMenu}>
          <div className={s.projectSwitcherLabel}>Your projects</div>
          {projects === null ? (
            <div className={s.projectSwitcherEmpty}>Loading…</div>
          ) : projects.length === 0 ? (
            <div className={s.projectSwitcherEmpty}>No other projects yet.</div>
          ) : (
            projects
              .filter((p) => p.id !== projectId)
              .slice(0, 8)
              .map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => router.push(`/build/${p.id}`)}>
                  <span className={s.projectSwitcherItemName}>{p.name || "Untitled project"}</span>
                </DropdownMenuItem>
              ))
          )}
          <div className={s.projectSwitcherSep} />
          <DropdownMenuItem onSelect={() => setShowCreate(true)}>New project…</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push("/projects")}>All projects</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewProjectModal open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
