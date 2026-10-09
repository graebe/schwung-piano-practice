// Copied from neon-ingvy-audio-plugins ui-kit @4e15cc8 (ui-kit/src/components/Select.jsx), MIT, Torben Gräber.
/*
 * A choice, not a quantity. Copyright (c) 2026 Torben Gräber. MIT.
 *
 * THE MECHANISM IS THE PART WORTH KEEPING: a styled div with a REAL, invisible
 * <select> stretched over it. The popup is then the OS's -- which is the only
 * kind that behaves correctly inside a plugin's WebView, where a div-based menu
 * would be clipped by the window and would not follow the pointer out of it.
 *
 * The caret is the design set's `chevron` Icon, as the Select card draws it.
 *
 * IT TAKES AN INDEX, NOT A PARAMETER. The Trance Gate's version was bound to a
 * host parameter and converted normalised values in and out; the Spectrogram's
 * fork took an index because it has no parameters to bind to. The index form is
 * the one that belongs in a kit -- a Select is a choice widget, and knowing
 * what a choice MEANS is the caller's business. See ParamSelect in the Trance
 * Gate's editor for the binding.
 *
 * `info` covers the label and the face: the hint bar shows it over either, and
 * the <select> carries it as its accessible description.
 */
import { For, Show, createSignal } from 'solid-js';
import { Icon } from './Icon.jsx';

export function Select(props) {
  const [open, setOpen] = createSignal(false);
  return (
    /* The label sits BESIDE the select, on the same 28px row -- these say how a
     * thing is measured or drawn rather than what its value is, and a panel of
     * knobs leaves no room above. */
    <div class="select-group" data-info={props.info}>
      <Show when={props.label}>
        <span class="select-label t-label" style={{ width: `${props.labelWidth ?? 44}px` }}>
          {props.label}
        </span>
      </Show>
      <div class="select" classList={{ open: open() }}
           style={{ width: `${props.width ?? 96}px` }}>
        <span class="select-value t-value">{props.options[props.value ?? 0]}</span>
        <Icon name="chevron" />
        <select
          aria-label={props.ariaLabel ?? props.label}
          aria-description={props.info}
          value={props.value ?? 0}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => { props.onChange?.(+e.currentTarget.value); setOpen(false); }}
        >
          <For each={props.options}>{(o, i) => <option value={i()}>{o}</option>}</For>
        </select>
      </div>
    </div>
  );
}
