import { useEffect } from "react";
import { useEditorStore, isDirty } from "../../store/editorStore";
export function EditorDraftGuard() {
  const pending = useEditorStore((s) =>
    Object.values(s.documents).some((doc) => isDirty(doc) || doc.saving),
  );
  useEffect(() => {
    if (!pending) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [pending]);
  return null;
}
