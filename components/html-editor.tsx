"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";

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

function normalizeEditorHtml(html: string) {
  const trimmed = (html || "").trim();
  if (!trimmed || trimmed === "<p></p>" || trimmed === "<p><br></p>") {
    return "";
  }
  return trimmed;
}

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
  }
>(function HtmlEditor(
  {
    value,
    onChange,
    revision = 0,
    disabled,
    placeholder,
    minHeightClass = "min-h-[12rem]",
  },
  ref
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lastEmittedRef = useRef(normalizeEditorHtml(value || ""));
  // Seed as already-applied so the first effect does not setContent and steal focus.
  const appliedRevisionRef = useRef<string | number | null>(revision);
  const applyingExternalRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-[var(--diy-red)] underline",
        },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? "Write…",
      }),
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
