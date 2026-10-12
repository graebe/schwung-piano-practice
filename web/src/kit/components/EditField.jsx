// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Torben Gräber
// From the neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/EditField.jsx).
/*
 * A field that edits a value in place: focused and selected the moment it
 * appears, committed on Enter or blur, abandoned on Escape.
 *
 * FOCUSED FROM onMount, NOT BY `autofocus`. The attribute only acts on page
 * load; a field inserted later -- which is every field here, since each
 * replaces a readout on click -- ignored it, so the first keystroke went
 * nowhere.
 */
import { onMount } from 'solid-js';
import { createTextEdit } from '../lib/edit.js';
import { infoAttrs } from '../lib/info.js';

export function EditField(props) {
  let el;
  const edit = createTextEdit({ onCommit: (v) => props.onCommit?.(v), onClose: () => props.onClose?.() });
  onMount(() => {
    el?.focus();
    el?.select();
  });
  return (
    <input
      ref={el}
      class={props.class}
      value={props.value ?? ''}
      inputmode={props.inputmode}
      aria-label={props.ariaLabel}
      {...infoAttrs(props.info)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (edit.keyDown(e.key, e.currentTarget.value)) e.preventDefault();
        /* The editor is inside a host that may treat keys as its own. */
        e.stopPropagation();
      }}
      onBlur={(e) => edit.blur(e.currentTarget.value)}
    />
  );
}
