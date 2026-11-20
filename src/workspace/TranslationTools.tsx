import * as React from "react";
import { IconButton } from "./controls";
import { translationLanguage } from "./translation";
import type { TranslationState } from "./hooks/useTranslation";
import { t } from "../i18n";

/** The translate / publish / show-original buttons and the progress line of the text pane. */
export function TranslationTools({
  state,
  canPublish,
  onDismissError,
}: {
  state: TranslationState;
  /** The document exists in Reader, so a translation can be published there. */
  canPublish: boolean;
  onDismissError: () => void;
}): React.ReactElement {
  const { job, blocks, translation, shown } = state;
  const running = job?.status === "running";
  const label = running
    ? t("workspace.translation.stop", { done: job.done, total: job.total })
    : blocks
      ? t("workspace.translation.current", {
          language: translationLanguage(state.language).name,
          suffix: translation?.complete ? "" : t("workspace.translation.incomplete"),
        })
      : t("workspace.translation.start");
  return (
    <>
      <IconButton icon="languages" label={label} active={running || !!blocks} onClick={state.pick} />
      {blocks && translation?.complete && canPublish && (
        <IconButton
          icon="share"
          label={t("workspace.publish.keepTitle")}
          disabled={state.publishing}
          onClick={state.publish}
        />
      )}
      {blocks && (
        <IconButton
          icon="book-open-text"
          label={t(shown ? "workspace.translation.showOriginal" : "workspace.translation.showTranslation")}
          active={shown}
          onClick={state.toggleShown}
        />
      )}
      {job && (
        <span className="rwt-translation-status" role="status">
          {running ? t("workspace.translation.progress", { done: job.done, total: job.total }) : job.error}
          {job.status === "error" && (
            <IconButton icon="x" label={t("workspace.action.hideError")} onClick={onDismissError} />
          )}
        </span>
      )}
    </>
  );
}
