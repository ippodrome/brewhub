import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Copy, Download, Trash2 } from "lucide-react";
import type { Device, ImportProfilesResult, Profile } from "@brewhub/shared-types";
import {
  createProfile,
  deleteProfile,
  downloadProfileExport,
  importProfiles,
  listProfiles,
  saveProfileAsTemplate,
  updateProfile,
} from "../api/profiles";
import { listHydrometers } from "../api/hydrometers";
import { updateDeviceConfig } from "../api/devices";
import { editTouchesPassedSteps, toRequest, type StepDraft } from "../lib/profile-steps";
import { StepEditor } from "./StepEditor";
import { OverflowMenu } from "./OverflowMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { ProfileProgress, stepLabel, useActiveProgress } from "./ProfileProgress";

type EditorState =
  | { mode: "new" }
  | { mode: "edit"; profile: Profile }
  | { mode: "duplicate"; profile: Profile };

function draftOf(profile: Profile): StepDraft {
  return profile.triggerType === "time"
    ? { triggerType: "time", steps: profile.steps }
    : { triggerType: "gravity", steps: profile.steps };
}

function describe(profile: Profile): string {
  return `${profile.triggerType === "gravity" ? "Gravity-based" : "Time-based"} · ${profile.steps.length} ${
    profile.steps.length === 1 ? "step" : "steps"
  }`;
}

export function ProfileManager({ device, onClose }: { device: Device; onClose: () => void }): JSX.Element {
  const [editor, setEditor] = useState<EditorState>({ mode: "new" });
  const [importResult, setImportResult] = useState<ImportProfilesResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const queryClient = useQueryClient();

  const profilesQuery = useQuery({ queryKey: ["profiles", device.id], queryFn: () => listProfiles(device.id) });
  const progressQuery = useActiveProgress(device.id);
  const progress = progressQuery.data?.active ? progressQuery.data : null;
  const activeId = progress?.profile.id ?? null;

  const hydrometersQuery = useQuery({ queryKey: ["hydrometers"], queryFn: listHydrometers });
  const hasHydrometer = (hydrometersQuery.data ?? []).some((h) => h.fermenterDeviceId === device.id);

  function refresh(): void {
    queryClient.invalidateQueries({ queryKey: ["profiles", device.id] });
    queryClient.invalidateQueries({ queryKey: ["profile-progress", device.id] });
    queryClient.invalidateQueries({ queryKey: ["devices"] });
  }

  const saveMutation = useMutation({
    mutationFn: ({ name, draft }: { name: string; draft: StepDraft }) =>
      editor.mode === "edit"
        ? updateProfile(device.id, editor.profile.id, toRequest(name, draft))
        : createProfile(device.id, toRequest(name, draft)),
    onSuccess: (saved) => {
      setNotice(
        editor.mode === "edit"
          ? saved.id === activeId
            ? `Saved “${saved.name}”. The running profile keeps its start time and the new target applies now.`
            : `Saved “${saved.name}”.`
          : `Created “${saved.name}”.`,
      );
      setEditor({ mode: "new" });
      refresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (profileId: number) => deleteProfile(device.id, profileId),
    onSuccess: () => {
      setConfirmDelete(null);
      refresh();
    },
  });

  const activateMutation = useMutation({
    mutationFn: (activeProfileId: number | null) => updateDeviceConfig(device.id, { activeProfileId }),
    onSuccess: refresh,
  });

  const templateMutation = useMutation({
    mutationFn: (profileId: number) => saveProfileAsTemplate(device.id, profileId),
    onSuccess: (t) => {
      setNotice(`Saved “${t.name}” to Templates — apply it to any fermenter from there.`);
      queryClient.invalidateQueries({ queryKey: ["profile-templates"] });
    },
  });

  const exportMutation = useMutation({
    mutationFn: (profileId: number | undefined) => downloadProfileExport(device.id, profileId),
  });

  const importMutation = useMutation({
    mutationFn: (file: File) => importProfiles(device.id, file),
    onSuccess: (result) => {
      setImportResult(result);
      refresh();
    },
    onError: () => setImportResult(null),
  });

  const editingActive = editor.mode === "edit" && editor.profile.id === activeId && progress;
  const warn = editingActive
    ? (draft: StepDraft) =>
        editTouchesPassedSteps(draftOf(editor.profile), draft, progress)
          ? `You're changing steps this brew has already been through (${stepLabel(progress).toLowerCase()}). The start time is kept, so the target jumps to wherever the new steps say it should be right now.`
          : null
    : undefined;

  return (
    <div className="mt-4 space-y-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-fg">Fermentation profiles</h3>
        <button onClick={onClose} className="text-xs text-dim hover:text-fg">
          Close
        </button>
      </div>

      {progress && <ProfileProgress deviceId={device.id} />}

      {notice && (
        <p className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok" role="status">
          {notice}
        </p>
      )}

      {profilesQuery.isLoading && <p className="text-xs text-dim">Loading profiles…</p>}
      {profilesQuery.data && profilesQuery.data.length === 0 && (
        <p className="text-sm text-muted">
          No profiles yet. Create one below, or start from a{" "}
          <Link to="/templates" className="text-amber underline-offset-2 hover:underline">
            template
          </Link>
          .
        </p>
      )}
      {profilesQuery.data && profilesQuery.data.length > 0 && (
        <ul className="space-y-2">
          {profilesQuery.data.map((profile) => {
            const isActive = profile.id === activeId;
            return (
              <li
                key={profile.id}
                className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2.5 ${
                  isActive ? "border-amber/40" : "border-line"
                }`}
              >
                <div className="min-w-[13rem] flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-fg">
                    <span className="truncate">{profile.name}</span>
                    {isActive && <span className="pill bg-amber/10 text-amber">Running</span>}
                  </p>
                  <p className="text-xs text-dim">
                    {describe(profile)}
                    {isActive && progress ? ` · ${stepLabel(progress)}` : ""}
                  </p>
                </div>
                <div className="-mr-1 ml-auto flex items-center gap-1">
                  {isActive ? (
                    <button
                      onClick={() => activateMutation.mutate(null)}
                      disabled={activateMutation.isPending}
                      className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => activateMutation.mutate(profile.id)}
                      disabled={activateMutation.isPending}
                      className="rounded-xl px-2.5 py-1 text-xs font-medium text-ok hover:bg-ok/10"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => setEditor({ mode: "edit", profile })}
                    className="rounded-xl px-2.5 py-1 text-xs text-muted hover:bg-tint hover:text-fg"
                  >
                    Edit
                  </button>
                  <OverflowMenu
                    label={`More actions for ${profile.name}`}
                    items={[
                      { label: "Duplicate", icon: Copy, onSelect: () => setEditor({ mode: "duplicate", profile }) },
                      { label: "Save as template", icon: BookmarkPlus, onSelect: () => templateMutation.mutate(profile.id) },
                      { label: "Export file", icon: Download, onSelect: () => exportMutation.mutate(profile.id) },
                      { label: "Delete…", icon: Trash2, destructive: true, onSelect: () => setConfirmDelete(profile) },
                    ]}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <StepEditor
        key={editor.mode === "new" ? "new" : `${editor.mode}-${editor.profile.id}`}
        title={
          editor.mode === "edit"
            ? `Edit ${editor.profile.name}${editor.profile.id === activeId ? " · running" : ""}`
            : editor.mode === "duplicate"
              ? `Duplicate ${editor.profile.name}`
              : "New profile"
        }
        initialName={
          editor.mode === "edit" ? editor.profile.name : editor.mode === "duplicate" ? `${editor.profile.name} (copy)` : ""
        }
        initialDraft={editor.mode === "new" ? undefined : draftOf(editor.profile)}
        allowGravity={hasHydrometer}
        submitLabel={editor.mode === "edit" ? "Save changes" : "Create profile"}
        pending={saveMutation.isPending}
        error={saveMutation.isError ? "Could not save the profile. Check the steps and try again." : null}
        warn={warn}
        onSubmit={(name, draft) => saveMutation.mutate({ name, draft })}
        onCancel={editor.mode === "new" ? undefined : () => setEditor({ mode: "new" })}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          onClick={() => exportMutation.mutate(undefined)}
          disabled={exportMutation.isPending || !profilesQuery.data?.length}
          className="chip disabled:opacity-40"
        >
          Export all
        </button>
        <label className="chip cursor-pointer">
          {importMutation.isPending ? "Importing…" : "Import file"}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) importMutation.mutate(file);
            }}
          />
        </label>
        <Link to="/templates" className="chip">
          Templates
        </Link>
      </div>

      {importResult && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-xs text-ok">
          <p>
            Imported {importResult.imported.length} {importResult.imported.length === 1 ? "profile" : "profiles"}.
          </p>
          {importResult.imported.some((p) => p.renamedFrom) && (
            <p className="mt-0.5 opacity-80">
              Renamed to avoid clashing with what's already here:{" "}
              {importResult.imported
                .filter((p) => p.renamedFrom)
                .map((p) => `${p.renamedFrom} → ${p.name}`)
                .join(", ")}
              .
            </p>
          )}
        </div>
      )}
      {importMutation.isError && (
        <p className="text-xs text-crit">
          {importMutation.error instanceof Error && importMutation.error.message.includes("JSON")
            ? "That file isn't valid JSON."
            : "Could not import that file — it doesn't look like a BrewHub profile export."}
        </p>
      )}
      {(exportMutation.isError || templateMutation.isError || activateMutation.isError) && (
        <p className="text-xs text-crit">
          {activateMutation.isError ? "Could not change the active profile." : "Something went wrong. Try again."}
        </p>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${confirmDelete.name}?`}
          confirmLabel="Delete profile"
          pendingLabel="Deleting…"
          pending={deleteMutation.isPending}
          error={deleteMutation.isError ? "Could not delete the profile." : null}
          onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        >
          {confirmDelete.id === activeId
            ? "This profile is running. Deleting it stops it, and the chamber holds its current target."
            : "Templates made from it are not affected."}
        </ConfirmDialog>
      )}
    </div>
  );
}
