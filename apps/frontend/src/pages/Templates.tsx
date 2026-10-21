import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";
import type { ProfileTemplate } from "@brewhub/shared-types";
import { applyTemplate, createTemplate, deleteTemplate, listTemplates, updateTemplate } from "../api/profiles";
import { listHydrometers } from "../api/hydrometers";
import { useLiveTelemetry } from "../ws/useLiveTelemetry";
import { formatMinutes, toRequest, type StepDraft } from "../lib/profile-steps";
import { StepEditor } from "../components/StepEditor";
import { ProfileCurve } from "../components/ProfileCurve";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";

function draftOf(t: ProfileTemplate): StepDraft {
  return t.triggerType === "time" ? { triggerType: "time", steps: t.steps } : { triggerType: "gravity", steps: t.steps };
}

function summary(t: ProfileTemplate): string {
  if (t.triggerType === "gravity") {
    const temps = t.steps.map((s) => s.targetC);
    return `Gravity-based · ${t.steps.length} steps · ${Math.min(...temps)}–${Math.max(...temps)} °C`;
  }
  const last = Math.max(...t.steps.map((s) => s.atMinutes));
  const temps = t.steps.map((s) => s.targetC);
  return `${t.steps.length} steps · ${formatMinutes(last)} · ${Math.min(...temps)}–${Math.max(...temps)} °C`;
}

function ApplyForm({ template, onDone }: { template: ProfileTemplate; onDone: (msg: string) => void }): JSX.Element {
  const { devices } = useLiveTelemetry();
  const fermenters = devices.filter((d) => d.type === "fermenter");
  const [deviceId, setDeviceId] = useState(fermenters[0]?.id ?? "");
  const [activate, setActivate] = useState(false);
  const queryClient = useQueryClient();
  const hydrometers = useQuery({ queryKey: ["hydrometers"], queryFn: listHydrometers });
  const needsHydrometer =
    template.triggerType === "gravity" && !(hydrometers.data ?? []).some((h) => h.fermenterDeviceId === deviceId);

  const mutation = useMutation({
    mutationFn: () => applyTemplate(template.id, deviceId, activate),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["profiles", deviceId] });
      queryClient.invalidateQueries({ queryKey: ["profile-progress", deviceId] });
      const name = fermenters.find((d) => d.id === deviceId)?.name ?? deviceId;
      onDone(r.activated ? `“${r.profile.name}” is now running on ${name}.` : `Added “${r.profile.name}” to ${name}.`);
    },
  });

  if (fermenters.length === 0) {
    return <p className="text-xs text-dim">Add a fermenter first — templates are applied to fermenters.</p>;
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl bg-surface p-3"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
    >
      <label className="min-w-[10rem] flex-1">
        <span className="text-xs font-medium text-muted">Fermenter</span>
        <select className="field mt-1 px-3 py-2 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {fermenters.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm text-muted">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[rgb(var(--c-amber))]"
          checked={activate}
          disabled={needsHydrometer}
          onChange={(e) => setActivate(e.target.checked)}
        />
        Start now
      </label>
      <button type="submit" disabled={mutation.isPending || !deviceId} className="btn-primary px-4 py-2 text-xs">
        {mutation.isPending ? "Applying…" : activate ? "Apply and start" : "Apply"}
      </button>
      {needsHydrometer && (
        <p className="w-full text-xs text-dim">This fermenter has no hydrometer, so the copy can be added but not started.</p>
      )}
      {mutation.isError && <p className="w-full text-xs text-crit">Could not apply the template.</p>}
    </form>
  );
}

function TemplateCard({
  template,
  onNotice,
}: {
  template: ProfileTemplate;
  onNotice: (msg: string) => void;
}): JSX.Element {
  const [mode, setMode] = useState<"idle" | "edit" | "apply">("idle");
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: ({ name, draft }: { name: string; draft: StepDraft }) => updateTemplate(template.id, toRequest(name, draft)),
    onSuccess: (t) => {
      setMode("idle");
      onNotice(`Saved “${t.name}”. Profiles already applied from it are unchanged.`);
      queryClient.invalidateQueries({ queryKey: ["profile-templates"] });
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteTemplate(template.id),
    onSuccess: () => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["profile-templates"] });
    },
  });

  if (mode === "edit") {
    return (
      <StepEditor
        title={`Edit template · ${template.name}`}
        initialName={template.name}
        initialDraft={draftOf(template)}
        allowGravity
        submitLabel="Save template"
        pending={save.isPending}
        error={save.isError ? "Could not save the template." : null}
        onSubmit={(name, draft) => save.mutate({ name, draft })}
        onCancel={() => setMode("idle")}
      />
    );
  }

  return (
    <article className="card min-w-0 p-5" aria-label={template.name}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-semibold text-fg">{template.name}</h2>
          <p className="mt-0.5 text-xs text-dim">{summary(template)}</p>
        </div>
        <button type="button" className="icon-btn -mr-2 -mt-1" aria-label={`Edit ${template.name}`} onClick={() => setMode("edit")}>
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="icon-btn -mr-2 -mt-1 hover:text-crit"
          aria-label={`Delete ${template.name}`}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>

      {template.triggerType === "time" ? (
        <ProfileCurve steps={template.steps} className="mt-4 h-16" />
      ) : (
        <ol className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
          {template.steps.map((s, i) => (
            <li key={i} className="rounded-full bg-tint px-2.5 py-1 tabular-nums">
              {s.atGravitySg.toFixed(3)} → {s.targetC} °C
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4">
        {mode === "apply" ? (
          <ApplyForm
            template={template}
            onDone={(msg) => {
              setMode("idle");
              onNotice(msg);
            }}
          />
        ) : (
          <button type="button" className="btn-ghost w-full py-2 text-sm" onClick={() => setMode("apply")}>
            Apply to fermenter…
          </button>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title={`Delete ${template.name}?`}
          confirmLabel="Delete template"
          pendingLabel="Deleting…"
          pending={remove.isPending}
          error={remove.isError ? "Could not delete the template." : null}
          onConfirm={() => remove.mutate()}
          onCancel={() => setConfirming(false)}
        >
          Profiles already applied from this template stay on their fermenters.
        </ConfirmDialog>
      )}
    </article>
  );
}

export function Templates(): JSX.Element {
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["profile-templates"], queryFn: listTemplates });

  const create = useMutation({
    mutationFn: ({ name, draft }: { name: string; draft: StepDraft }) => createTemplate(toRequest(name, draft)),
    onSuccess: (t) => {
      setCreating(false);
      setNotice(`Created “${t.name}”.`);
      queryClient.invalidateQueries({ queryKey: ["profile-templates"] });
    },
  });

  return (
    <div className="page max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Library</p>
          <h1 className="page-title mt-1">Templates</h1>
          <p className="mt-1 text-sm text-muted">Fermentation schedules you can reuse on any fermenter.</p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New template
          </button>
        )}
      </div>

      {notice && (
        <p className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-2.5 text-sm text-ok" role="status">
          {notice}
        </p>
      )}

      {creating && (
        <StepEditor
          title="New template"
          allowGravity
          submitLabel="Create template"
          pending={create.isPending}
          error={create.isError ? "Could not create the template." : null}
          onSubmit={(name, draft) => create.mutate({ name, draft })}
          onCancel={() => setCreating(false)}
        />
      )}

      {query.isLoading && <div className="card h-40 animate-pulse bg-tint/60" />}
      {query.data && query.data.length === 0 && !creating && (
        <EmptyState
          icon={Layers}
          title="No templates yet"
          action={
            <button onClick={() => setCreating(true)} className="btn-primary">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New template
            </button>
          }
        >
          Build one here, or open a fermenter's Profiles and choose “Save as template” on a schedule you like.
        </EmptyState>
      )}
      {query.data && query.data.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2">
          {query.data.map((t) => (
            <TemplateCard key={t.id} template={t} onNotice={setNotice} />
          ))}
        </div>
      )}
    </div>
  );
}
