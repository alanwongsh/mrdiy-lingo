"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as ProseNode } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import { looksLikeTypedAddress } from "@/lib/translation/cleanup";

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onClick,
  className = "",
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ?? false}
      tabIndex={-1}
      disabled={disabled}
      className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${
        active
          ? "bg-white text-[var(--diy-red)] shadow-sm"
          : "text-slate-700 hover:bg-white"
      } ${className}`}
      onMouseDown={(e) => {
        // Keep caret in the editor; don't let the button steal focus.
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

const MAX_IMAGE_BYTES = 500_000;

/** Accept http(s), site-relative, and data-image sources. Reject script URLs. */
function imageSrcFromPrompt(raw: string): string | null {
  const value = raw.trim();
  if (!value || /^javascript:/i.test(value)) return null;
  if (value.startsWith("data:image/")) {
    return value.includes(",") ? value : null;
  }
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch {
    return null;
  }
  return null;
}

function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (src.startsWith("data:image/")) resolve(src);
      else reject(new Error("Could not read that image."));
    };
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files).filter((file) =>
    file.type.startsWith("image/")
  );
  if (fromFiles.length) return fromFiles;
  const fromItems: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return fromItems;
}

function insertImages(
  editor: Editor | null,
  view: EditorView,
  srcs: string[],
  pos?: number
) {
  if (!editor || editor.isDestroyed || !srcs.length) return;
  const content = srcs.map((src) => ({ type: "image", attrs: { src } }));
  const chain = editor.chain().focus();
  if (pos == null) {
    chain.insertContent(content).run();
    return;
  }
  const at = Math.max(0, Math.min(pos, view.state.doc.content.size));
  chain.insertContentAt(at, content).run();
}

async function placeImageFiles(
  editor: Editor | null,
  view: EditorView,
  files: File[],
  pos?: number
) {
  if (!editor || editor.isDestroyed || !files.length) return;
  const srcs: string[] = [];
  let skippedLarge = false;
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) {
      skippedLarge = true;
      continue;
    }
    try {
      srcs.push(await readImageFile(file));
    } catch {
      window.alert("Could not read that image.");
    }
  }
  if (skippedLarge) {
    window.alert("That image is too large. Use an image URL instead.");
  }
  insertImages(editor, view, srcs, pos);
}

function normalizeEditorHtml(html: string) {
  const trimmed = (html || "").trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") {
    return "";
  }
  return trimmed;
}

const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

function alignmentOf(element: HTMLElement) {
  const fromStyle = element.style.textAlign.trim().toLowerCase();
  if (ALIGNMENTS.has(fromStyle)) return fromStyle;
  const fromAttr = (element.getAttribute("align") ?? "").trim().toLowerCase();
  return ALIGNMENTS.has(fromAttr) ? fromAttr : "";
}

/** Keep centered captions with their image, and drop brand names that were turned into links. */
function transformPastedHtml(html: string) {
  if (!html || typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const styled = doc.body.querySelectorAll<HTMLElement>(
    "p, h1, h2, h3, h4, h5, h6, div, figure, figcaption, td"
  );
  styled.forEach((element) => {
    const alignment = alignmentOf(element);
    if (alignment && !element.style.textAlign) element.style.textAlign = alignment;
  });
  doc.body.querySelectorAll<HTMLElement>("p, h2, h3").forEach((element) => {
    if (element.style.textAlign) return;
    let parent = element.parentElement;
    while (parent && parent !== doc.body) {
      const alignment = parent.style.textAlign.trim().toLowerCase();
      if (ALIGNMENTS.has(alignment) && alignment !== "left") {
        element.style.textAlign = alignment;
        return;
      }
      parent = parent.parentElement;
    }
  });
  return doc.body.innerHTML;
}

const locatePluginKey = new PluginKey("qualityLocate");

function findTextRange(
  doc: ProseNode,
  phrase: string
): { from: number; to: number } | null {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return null;
  let flat = "";
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      if (node.isBlock && flat.length > 0 && !flat.endsWith("\n")) {
        flat += "\n";
        positions.push(-1);
      }
      return;
    }
    for (let index = 0; index < node.text.length; index += 1) {
      flat += node.text[index].toLowerCase();
      positions.push(pos + index);
    }
  });
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  let from = -1;
  let to = -1;
  for (let index = at; index < at + needle.length && index < positions.length; index += 1) {
    const position = positions[index];
    if (position < 0) continue;
    if (from < 0) from = position;
    to = position + 1;
  }
  if (from < 0 || to <= from) return null;
  return { from, to };
}

function paragraphIsBlank(node: ProseNode) {
  let blank = true;
  node.descendants((child) => {
    if (child.type.name === "image") blank = false;
    if (child.isText && child.text?.trim()) blank = false;
  });
  return blank;
}

/**
 * Paste splits a centered image caption into an empty centered paragraph plus a left-aligned one.
 * Put the alignment back. Links are left alone: shouldAutoLink keeps bare words such as MR.DIY
 * from being linked, and a real link like <a href="http://yayasanmrdiy.com">yayasanmrdiy.com</a>
 * has the same shape, so it cannot be told apart afterwards.
 */
const RepairPastedHtml = Extension.create({
  name: "repairPastedHtml",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          let tr = state.tr;
          let changed = false;

          const blanks: { pos: number; align: string }[] = [];
          tr.doc.descendants((node, pos) => {
            if (node.type.name !== "paragraph") return;
            const align = String(node.attrs.textAlign ?? "");
            if (!ALIGNMENTS.has(align) || align === "left") return;
            if (!paragraphIsBlank(node)) return;
            blanks.push({ pos, align });
          });
          blanks.reverse().forEach((blank) => {
            const $pos = tr.doc.resolve(blank.pos);
            const parent = $pos.parent;
            const index = $pos.index();
            if (index + 1 >= parent.childCount) return;
            let next = parent.child(index + 1);
            let nextPos = blank.pos + $pos.parent.child(index).nodeSize;
            if (next.type.name === "image" && index + 2 < parent.childCount) {
              const caption = parent.child(index + 2);
              if (caption.type.name !== "paragraph") return;
              nextPos += next.nodeSize;
              next = caption;
            }
            if (next.type.name !== "paragraph" || next.attrs.textAlign) return;
            tr = tr.setNodeMarkup(nextPos, undefined, { ...next.attrs, textAlign: blank.align });
            tr = tr.delete(blank.pos, blank.pos + $pos.parent.child(index).nodeSize);
            changed = true;
          });
          return changed ? tr : null;
        },
      }),
    ];
  },
});

const QualityLocate = Extension.create<{ getPhrase: () => string }>({
  name: "qualityLocate",
  addProseMirrorPlugins() {
    const getPhrase = this.options.getPhrase;
    return [
      new Plugin({
        key: locatePluginKey,
        props: {
          decorations(state) {
            const phrase = getPhrase();
            const range = phrase ? findTextRange(state.doc, phrase) : null;
            if (!range) return null;
            try {
              return DecorationSet.create(state.doc, [
                Decoration.inline(range.from, range.to, { class: "quality-locate" }),
              ]);
            } catch {
              return null;
            }
          },
        },
      }),
    ];
  },
});

export type HtmlEditorHandle = {
  getHTML: () => string;
};

export const HtmlEditor = forwardRef<
  HtmlEditorHandle,
  {
    value: string;
    onChange: (html: string) => void;
    /** When this changes, reload `value` into the editor (language switch, translate, etc.). */
    revision?: string | number;
    disabled?: boolean;
    placeholder?: string;
    minHeightClass?: string;
    /** Phrase to highlight inside the body without changing the saved HTML. */
    highlight?: string;
  }
>(function HtmlEditor(
  {
    value,
    onChange,
    revision = 0,
    disabled,
    placeholder,
    minHeightClass = "min-h-[12rem]",
    highlight = "",
  },
  ref
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;

  const lastEmittedRef = useRef(normalizeEditorHtml(value || ""));
  // Seed as already-applied so the first effect does not setContent and steal focus.
  const appliedRevisionRef = useRef<string | number | null>(revision);
  const applyingExternalRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        // Bare words with a dot, such as the brand MR.DIY, look like domains to linkify.
        // Auto-link only text written as an address.
        shouldAutoLink: looksLikeTypedAddress,
        HTMLAttributes: {
          class: "text-[var(--diy-red)] underline",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write…",
      }),
      RepairPastedHtml,
      QualityLocate.configure({ getPhrase: () => highlightRef.current }),
    ],
    // Seed once — after that only `revision` pushes external content in.
    content: value || "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: `${minHeightClass} html-editor-surface tiptap px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none`,
        spellcheck: "false",
        autocapitalize: "off",
        autocorrect: "off",
        autocomplete: "off",
      },
      transformPastedHTML: transformPastedHtml,
      handlePaste: (view, event) => {
        if (!view.editable) return false;
        const html = event.clipboardData?.getData("text/html") ?? "";
        if (/<img[\s>/]/i.test(html)) return false;
        const files = imageFilesFrom(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        void placeImageFiles(editorRef.current, view, files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !view.editable) return false;
        const html = event.dataTransfer?.getData("text/html") ?? "";
        if (/<img[\s>/]/i.test(html)) return false;
        const uri = (event.dataTransfer?.getData("text/uri-list") ?? "")
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line && !line.startsWith("#"));
        const droppedUrl = uri ? imageSrcFromPrompt(uri) : null;
        const files = imageFilesFrom(event.dataTransfer);
        if (!droppedUrl && !files.length) return false;
        event.preventDefault();
        const coords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (droppedUrl) {
          insertImages(editorRef.current, view, [droppedUrl], coords?.pos);
          return true;
        }
        void placeImageFiles(editorRef.current, view, files, coords?.pos);
        return true;
      },
    },
    onCreate: ({ editor: current }) => {
      editorRef.current = current;
    },
    onDestroy: () => {
      editorRef.current = null;
    },
    onUpdate: ({ editor: current }) => {
      if (applyingExternalRef.current) return;
      const html = normalizeEditorHtml(current.getHTML());
      if (html === lastEmittedRef.current) return;
      lastEmittedRef.current = html;
      onChangeRef.current(html);
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      getHTML: () => {
        if (!editor) return lastEmittedRef.current;
        const live = normalizeEditorHtml(editor.getHTML());
        return live || lastEmittedRef.current;
      },
    }),
    [editor]
  );

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr);
  }, [editor, highlight]);

  // Apply external content only when revision changes — never while syncing
  // every keystroke via `value` (that steals the caret).
  useEffect(() => {
    if (!editor) return;
    if (appliedRevisionRef.current === revision) return;
    appliedRevisionRef.current = revision;

    const next = normalizeEditorHtml(value || "");
    const current = normalizeEditorHtml(editor.getHTML());
    if (next === current) {
      lastEmittedRef.current = next;
      return;
    }

    applyingExternalRef.current = true;
    editor.commands.setContent(next || "", { emitUpdate: false });
    lastEmittedRef.current = next;
    queueMicrotask(() => {
      applyingExternalRef.current = false;
    });
  }, [editor, revision, value]);

  if (!editor) {
    return (
      <div
        className={`rounded-lg border border-[var(--hub-border)] bg-slate-50 ${minHeightClass}`}
      />
    );
  }

  return (
    <div
      className={`overflow-hidden rounded-lg border border-[var(--hub-border)] bg-white ${
        disabled ? "opacity-70" : ""
      }`}
    >
      <div
        className="flex flex-wrap gap-1 border-b border-[var(--hub-border)] bg-slate-50 px-2 py-1.5"
        role="toolbar"
        aria-label="Formatting"
      >
        <ToolbarButton
          label="B"
          title="Bold"
          className="font-bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          title="Italic"
          className="italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="U"
          title="Underline"
          className="underline"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          label="H2"
          title="Heading"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        {(
          [
            ["left", "Left", "Align left"],
            ["center", "Center", "Align center"],
            ["right", "Right", "Align right"],
          ] as const
        ).map(([alignment, label, title]) => (
          <ToolbarButton
            key={alignment}
            label={label}
            title={title}
            active={
              alignment === "left"
                ? !editor.isActive({ textAlign: "center" }) &&
                  !editor.isActive({ textAlign: "right" }) &&
                  !editor.isActive({ textAlign: "justify" })
                : editor.isActive({ textAlign: alignment })
            }
            disabled={disabled}
            onClick={() =>
              alignment === "left"
                ? editor.chain().focus().unsetTextAlign().run()
                : editor.chain().focus().setTextAlign(alignment).run()
            }
          />
        ))}
        <ToolbarButton
          label="• List"
          title="Bullet list"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="1. List"
          title="Numbered list"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Link"
          title="Link"
          active={editor.isActive("link")}
          disabled={disabled}
          onClick={() => {
            if (editor.isActive("link")) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            const previous = editor.getAttributes("link").href as
              | string
              | undefined;
            const url = window.prompt("Link URL", previous ?? "https://");
            if (!url) return;
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: url })
              .run();
          }}
        />
        <ToolbarButton
          label="Image"
          title="Image"
          active={editor.isActive("image")}
          disabled={disabled}
          onClick={() => {
            const current = editor.getAttributes("image").src as
              | string
              | undefined;
            const seed =
              editor.isActive("image") && current && !current.startsWith("data:")
                ? current
                : "https://";
            const entered = window.prompt("Image URL", seed);
            if (entered == null) return;
            const src = imageSrcFromPrompt(entered);
            if (!src) {
              window.alert("Enter an http(s) image URL.");
              return;
            }
            if (editor.isActive("image")) {
              editor.chain().focus().updateAttributes("image", { src }).run();
              return;
            }
            editor.chain().focus().setImage({ src }).run();
          }}
        />
        <ToolbarButton
          label="Clear"
          title="Clear formatting"
          disabled={disabled}
          onClick={() => {
            lastEmittedRef.current = "";
            editor.chain().focus().clearContent().run();
          }}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
});

export function HtmlContent({
  html,
  className = "",
}: {
  html: string;
  className?: string;
}) {
  if (!html?.trim()) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <div
      className={`html-editor-surface text-sm leading-relaxed text-slate-900 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
