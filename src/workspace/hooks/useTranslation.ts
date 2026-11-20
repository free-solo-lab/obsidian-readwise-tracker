import * as React from "react";
import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { BookWorkspaceService } from "../service";
import type { ContentResolution, WorkspaceDocument } from "../types";
import type { TextBlock } from "../focus";
import { WorkspacePicker, type Choice } from "../controls";
import {
  TRANSLATION_LANGUAGES,
  translationTargets,
  type Translation,
  type TranslationJob,
} from "../translation";
import {
  resolveTranslationView,
  translationLanguagesOf,
  type TranslationView,
  type TranslationViewPreferences,
} from "../translationView";
import { t } from "../../i18n";

interface Options {
  app: App;
  service: BookWorkspaceService;
  document?: WorkspaceDocument;
  source?: ContentResolution;
  blocks: TextBlock[];
  invoke: (task: Promise<unknown>) => void;
  /** The view each book was last read in, by document id. */
  preferences: TranslationViewPreferences;
  /** Record the view the reader just chose for this book. */
  remember: (view: TranslationView) => void;
}

export interface TranslationState {
  language: string;
  translation?: Translation;
  job?: TranslationJob;
  /** Translated blocks keyed like the original's, only while they belong to the current text. */
  blocks?: Record<string, string>;
  /** The reader chose to see the translation and one exists for this text. */
  shown: boolean;
  toggleShown: () => void;
  publishing: boolean;
  /** Pick a target language and start (or continue) translating; stops a running one. */
  pick: () => void;
  /** Send the finished translation to Reader as its own article. */
  publish: () => void;
}

/**
 * The book's translation and whether it is on screen. A book opens the way it was last read,
 * and in its translation when nothing is remembered yet; every change of view is remembered.
 */
export function useTranslation({
  app,
  service,
  document,
  source,
  blocks,
  invoke,
  preferences,
  remember,
}: Options): TranslationState {
  // Unset until the document is known: which translations exist decides the first view.
  const [view, setView] = React.useState<TranslationView>();
  const [translation, setTranslation] = React.useState<Translation>();
  const [publishing, setPublishing] = React.useState(false);
  const language = view?.language ?? TRANSLATION_LANGUAGES[0].code;
  const visible = view?.shown ?? false;
  const job = React.useSyncExternalStore(
    (listener) => service.translations.subscribe(listener),
    () => (document ? service.translations.job(document.id) : undefined),
  );
  const resolved = React.useRef<string>();
  React.useEffect(() => {
    if (!document || resolved.current === document.id) return;
    resolved.current = document.id;
    const available = translationLanguagesOf(document, (path) => service.storage.exists(path));
    setView(resolveTranslationView(preferences[document.id], available));
  }, [document, service, preferences]);
  React.useEffect(() => {
    if (!document || !view) return;
    let alive = true;
    void service.translations
      .load(document, view.language)
      .then((loaded) => alive && setTranslation(loaded))
      .catch(() => alive && setTranslation(undefined));
    return () => {
      alive = false;
    };
  }, [document, service, view?.language, job?.done, job?.status]);
  // A translation belongs to one version of the text: its blocks are keyed by position.
  const translated =
    translation && source && translation.revision === source.revision ? translation.blocks : undefined;

  const choose = (next: TranslationView) => {
    setView(next);
    remember(next);
  };

  const pick = () => {
    if (!document || !source) return;
    if (job?.status === "running") return service.translations.cancel(document.id);
    const choices: Choice[] = translationTargets(source.markdown).map((item) => ({
      id: item.code,
      title: item.name,
      detail:
        item.code === language && translated
          ? t(translation?.complete ? "workspace.translation.done" : "workspace.translation.continue")
          : undefined,
    }));
    new WorkspacePicker(
      app,
      choices,
      (choice) => {
        choose({ language: choice.id, shown: true });
        invoke(service.translations.start(document, blocks, source.revision, choice.id));
      },
      t("workspace.picker.translateTo"),
    ).open();
  };

  const publish = () => {
    if (!document || !source || publishing) return;
    const choices: Choice[] = [
      { id: "keep", title: t("workspace.publish.keepTitle"), detail: t("workspace.publish.keepDetail") },
      { id: "archive", title: t("workspace.publish.archiveTitle"), detail: t("workspace.publish.archiveDetail") },
    ];
    new WorkspacePicker(
      app,
      choices,
      (choice) => {
        setPublishing(true);
        new Notice(t("workspace.publish.sending"));
        invoke(
          service
            .publishTranslation(document, source.markdown, choice.id === "archive" ? "archive" : "keep", language)
            .then(() => new Notice(t("workspace.publish.sent")))
            .finally(() => setPublishing(false)),
        );
      },
      t("workspace.publish.picker"),
    ).open();
  };

  return {
    language,
    translation,
    job,
    blocks: translated,
    shown: visible && !!translated,
    toggleShown: () => choose({ language, shown: !visible }),
    publishing,
    pick,
    publish,
  };
}
