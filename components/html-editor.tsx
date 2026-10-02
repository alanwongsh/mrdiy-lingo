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
  active,
  disabled,
  onClick,
  className = "",
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      className={`rounded px-2 py-1 text-xs font-semibold disabled:opacity-40 ${
        active
          ? "bg-white text-[var(--diy-red)] shadow-sm"
          : "text-slate-700 hover:bg-white"
      } ${className}`}
      onMouseDown={(e) => {
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
    disabled?: boolean;
    placeholder?: string;
    minHeightClass?: string;
  }
>(function HtmlEditor(
  {
    value,
    onChange,
    disabled,
    placeholder,
    minHeightClass = "min-h-[12rem]",
  },
  ref
) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lastEmittedRef = useRef(normalizeEditorHtml(value || ""));
  const suppressEmptyUntilRef = useRef(0);
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
    content: value || "",
    editable: !disabled,
    editorProps: {
      attributes: {
        class: `${minHeightClass} html-editor-surface tiptap px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none`,
      },
    },
    onCreate: () => {
      suppressEmptyUntilRef.current = Date.now() + 800;
    },
    onUpdate: ({ editor: current }) => {
      if (applyingExternalRef.current) return;
      const html = normalizeEditorHtml(current.getHTML());
      const text = current.getText().trim();

      // TipTap can emit empty docs during setContent / remount; ignore those.
      if (!html) {
        if (text) return;
        if (Date.now() < suppressEmptyUntilRef.current) return;
      }

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
    if (!editor) return;
    const next = normalizeEditorHtml(value || "");

    // Keep lastEmitted aligned when parent is the source of truth.
    if (next === lastEmittedRef.current) {
      // Still ensure TipTap isn't sitting on an empty doc while props have content.
      const current = normalizeEditorHtml(editor.getHTML());
      if (next && !current) {
        applyingExternalRef.current = true;
        suppressEmptyUntilRef.current = Date.now() + 500;
        editor.commands.setContent(next, { emitUpdate: false });
        queueMicrotask(() => {
          applyingExternalRef.current = false;
        });
      }
      return;
    }

    const current = normalizeEditorHtml(editor.getHTML());
    if (next === current) {
      lastEmittedRef.current = next;
      return;
    }

    applyingExternalRef.current = true;
    suppressEmptyUntilRef.current = Date.now() + 500;
    editor.commands.setContent(next || "", { emitUpdate: false });
    lastEmittedRef.current = next;
    queueMicrotask(() => {
      applyingExternalRef.current = false;
    });
  }, [editor, value]);

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
          className="font-bold"
          active={editor.isActive("bold")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          className="italic"
          active={editor.isActive("italic")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="U"
          className="underline"
          active={editor.isActive("underline")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        />
        <ToolbarButton
          label="H2"
          active={editor.isActive("heading", { level: 2 })}
          disabled={disabled}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
        <ToolbarButton
          label="• List"
          active={editor.isActive("bulletList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="1. List"
          active={editor.isActive("orderedList")}
          disabled={disabled}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Link"
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
          disabled={disabled}
          onClick={() => {
            lastEmittedRef.current = "";
            suppressEmptyUntilRef.current = 0;
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
