import { useState } from "react";
import { Plus } from "lucide-react";

export function MysteryListing({ text, imageUrls, onSaveClue }: { text?: string; imageUrls?: string[]; onSaveClue?: (clue: string) => void }) {
  const [selection, setSelection] = useState<{ source: string; excerpt: string }>();
  const excerpt = selection?.source === text ? selection?.excerpt : undefined;

  return <details className="mystery-section mystery-listing">
    <summary>Listing</summary>
    {text ? <>
      {onSaveClue && <p>Select text in the listing to save it as a clue.</p>}
      <textarea aria-label="Cache listing text" readOnly value={text} rows={Math.min(12, Math.max(4, Math.ceil(text.length / 100)))} onSelect={(event) => {
        const { selectionStart, selectionEnd, value } = event.currentTarget;
        setSelection({ source: text, excerpt: value.slice(selectionStart, selectionEnd).trim() });
      }} />
      {onSaveClue && <button className="secondary-button" type="button" disabled={!excerpt} onClick={() => {
        if (!excerpt) return;
        onSaveClue(excerpt);
        setSelection(undefined);
      }}><Plus size={13} /> Add selection to clues</button>}
    </> : <p>No listing text imported.</p>}
    {imageUrls?.map((url, index) => <a className="text-button" href={url} key={url} target="_blank" rel="noreferrer">Open listing image {index + 1}</a>)}
  </details>;
}
