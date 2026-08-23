"use client";

import { KeyboardEvent, useEffect, useId, useState } from "react";
import { LoaderCircle, MapPin, Navigation } from "lucide-react";
import { apiFetch } from "../lib/api";

export type SelectedPlace = {
  label: string;
  latitude: number;
  longitude: number;
  kind: string;
};

type PlaceAutocompleteProps = {
  label: string;
  placeholder: string;
  kind: "origin" | "destination";
  value: string;
  selected: SelectedPlace | null;
  onChange: (value: string) => void;
  onSelect: (place: SelectedPlace | null) => void;
};

export function PlaceAutocomplete({
  label,
  placeholder,
  kind,
  value,
  selected,
  onChange,
  onSelect
}: PlaceAutocompleteProps) {
  const inputId = useId();
  const listId = `${inputId}-suggestions`;
  const [suggestions, setSuggestions] = useState<SelectedPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3 || selected?.label === value) {
      setSuggestions([]);
      setOpen(false);
      setLoading(false);
      setSearched(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      void apiFetch<{ suggestions: SelectedPlace[] }>(`/map/place-suggestions?q=${encodeURIComponent(query)}`, {
        signal: controller.signal
      })
        .then(({ suggestions: nextSuggestions }) => {
          setSuggestions(nextSuggestions);
          setSearched(true);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setSuggestions([]);
          setSearched(true);
          setOpen(true);
        })
        .finally(() => setLoading(false));
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [selected?.label, value]);

  function choose(place: SelectedPlace) {
    onChange(place.label);
    onSelect(place);
    setOpen(false);
    setSuggestions([]);
    setActiveIndex(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!suggestions.length || !open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current <= 0 ? suggestions.length - 1 : current - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(suggestions[activeIndex]!);
    }
  }

  const Icon = kind === "destination" ? Navigation : MapPin;
  return <div className="travel-place-field">
    <label htmlFor={inputId}>{label}</label>
    <div className="travel-place-input">
      <Icon size={16} />
      <input
        id={inputId}
        value={value}
        placeholder={placeholder}
        maxLength={200}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          onSelect(null);
        }}
      />
      {loading && <LoaderCircle className="spin" size={15} aria-label="Finding places" />}
    </div>
    {open && <div className="travel-place-suggestions" id={listId} role="listbox">
      {suggestions.map((place, index) => <button
        id={`${listId}-${index}`}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className={activeIndex === index ? "active" : ""}
        key={`${place.latitude}:${place.longitude}:${place.label}`}
        onMouseDown={(event) => event.preventDefault()}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(place)}
      >
        <MapPin size={15} />
        <span><strong>{place.label.split(",")[0]}</strong><small>{place.label.split(",").slice(1).join(",").trim() || place.kind}</small></span>
      </button>)}
      {searched && !loading && !suggestions.length && <p>No places found</p>}
    </div>}
  </div>;
}
