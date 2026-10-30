import {
  BuiltinActionType,
  createLibrary,
  defineComponent,
  Renderer,
  useStateField,
  useTriggerAction,
  type ActionEvent,
  type ActionPlan,
  type ComponentRenderer,
  type OpenUIError,
} from "@openuidev/react-lang";
/* oxlint-disable react/no-array-index-key -- Program data is positional with no identity; rows hold no local state. */
import { createContext, use, useState, type ReactNode } from "react";

import { OPENUI_COMPONENT_SPECS, OPENUI_ROOT, type OpenUiComponentName } from "./library.ts";

type Props = Record<string, unknown>;

const OpenUrlContext = createContext<(url: string) => void>(() => undefined);

const text = (value: unknown) => (value == null ? "" : String(value));
const toneClass = (tone: unknown) => `tone-${typeof tone === "string" ? tone : "neutral"}`;
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

function LineChart({ props }: { props: Props }) {
  const labels = (props.labels as string[]) ?? [];
  const series = ((props.series as Array<{ props?: Props }>) ?? []).flatMap((entry) =>
    entry?.props
      ? [{ name: text(entry.props.name), values: (entry.props.values as number[]) ?? [] }]
      : [],
  );
  const all = series.flatMap((entry) => entry.values);
  const min = Math.min(0, ...all);
  const span = Math.max(...all, 0) - min || 1;
  const points = (values: number[]) =>
    values
      .map((value, index) => {
        const x = values.length > 1 ? (index / (values.length - 1)) * 600 : 300;
        return `${x.toFixed(1)},${(200 - ((value - min) / span) * 196 - 2).toFixed(1)}`;
      })
      .join(" ");
  return (
    <figure className="oui-chart">
      {props.title ? <figcaption>{text(props.title)}</figcaption> : null}
      <svg
        viewBox="0 0 600 200"
        preserveAspectRatio="none"
        role="img"
        aria-label={text(props.title)}
      >
        {series.map((entry, index) => (
          <polyline
            key={entry.name}
            points={points(entry.values)}
            fill="none"
            stroke={`var(--chart-${(index % 6) + 1})`}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="oui-axis">
        {labels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      {series.length > 1 ? (
        <div className="oui-legend">
          {series.map((entry, index) => (
            <span key={entry.name}>
              <i style={{ background: `var(--chart-${(index % 6) + 1})` }} />
              {entry.name}
            </span>
          ))}
        </div>
      ) : null}
    </figure>
  );
}

function Tabs({ props, renderNode }: { props: Props; renderNode: (value: unknown) => ReactNode }) {
  const items = ((props.items as Array<{ props?: Props }>) ?? []).flatMap((item) =>
    item?.props ? [item.props] : [],
  );
  const [selected, setSelected] = useState(0);
  const current = items[Math.min(selected, items.length - 1)];
  return (
    <div className="oui-tabs">
      <div role="tablist">
        {items.map((item, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            aria-selected={index === selected}
            onClick={() => setSelected(index)}
          >
            {text(item.label)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="oui-stack oui-gap-m">
        {current ? renderNode(current.children) : null}
      </div>
    </div>
  );
}

function Button({ props }: { props: Props }) {
  const triggerAction = useTriggerAction();
  const label = text(props.label);
  return (
    <button
      type="button"
      className={`oui-button oui-button-${typeof props.variant === "string" ? props.variant : "primary"}`}
      onClick={() => triggerAction(label, undefined, props.action as ActionPlan | undefined)}
    >
      {label}
    </button>
  );
}

function Input({ props }: { props: Props }) {
  const field = useStateField(text(props.name), props.value);
  return (
    <input
      className="oui-field"
      name={field.name}
      aria-label={field.name}
      placeholder={text(props.placeholder)}
      value={text(field.value)}
      onChange={(event) => field.setValue(event.target.value)}
    />
  );
}

function Select({ props }: { props: Props }) {
  const field = useStateField(text(props.name), props.value);
  const options = (props.options as string[]) ?? [];
  return (
    <select
      className="oui-field"
      name={field.name}
      aria-label={field.name}
      value={text(field.value ?? options[0])}
      onChange={(event) => field.setValue(event.target.value)}
    >
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function Checkbox({ props }: { props: Props }) {
  const field = useStateField(text(props.name), props.value);
  return (
    <label className="oui-check">
      <input
        type="checkbox"
        checked={field.value === true}
        onChange={(event) => field.setValue(event.target.checked)}
      />
      {text(props.label)}
    </label>
  );
}

function Slider({ props }: { props: Props }) {
  const field = useStateField(text(props.name), props.value);
  const value = typeof field.value === "number" ? field.value : Number(props.min);
  return (
    <label className="oui-slider">
      <input
        type="range"
        min={Number(props.min)}
        max={Number(props.max)}
        step={typeof props.step === "number" ? props.step : 1}
        value={value}
        onChange={(event) => field.setValue(Number(event.target.value))}
      />
      <output>{value}</output>
    </label>
  );
}

const RENDERERS: Record<OpenUiComponentName, ComponentRenderer<any>> = {
  Stack: ({ props, renderNode }) => (
    <div
      className={`oui-stack oui-${text(props.direction || "column")} oui-gap-${text(props.gap || "m")}`}
    >
      {renderNode(props.children)}
    </div>
  ),
  Card: ({ props, renderNode }) => (
    <section className="oui-card">
      {props.title ? <h3>{text(props.title)}</h3> : null}
      <div className="oui-stack oui-gap-m">{renderNode(props.children)}</div>
    </section>
  ),
  Heading: ({ props }) => {
    const level = Math.min(3, Math.max(1, Number(props.level) || 2));
    const Tag = `h${level}` as "h1" | "h2" | "h3";
    return <Tag>{text(props.text)}</Tag>;
  },
  Text: ({ props, renderNode }) => (
    <p className={`oui-text-${text(props.tone || "default")}`}>{renderNode(props.text)}</p>
  ),
  Code: ({ props }) => (
    <pre className="oui-code">
      <code>{text(props.code)}</code>
    </pre>
  ),
  Stat: ({ props, renderNode }) => (
    <div className={`oui-stat oui-${toneClass(props.tone)}`}>
      <span className="oui-stat-label">{text(props.label)}</span>
      <strong className="oui-stat-value">{renderNode(props.value)}</strong>
      {props.detail ? <span className="oui-stat-detail">{text(props.detail)}</span> : null}
    </div>
  ),
  Badge: ({ props, renderNode }) => (
    <span className={`oui-badge oui-${toneClass(props.tone)}`}>{renderNode(props.label)}</span>
  ),
  Table: ({ props, renderNode }) => (
    <div className="oui-table">
      <table>
        <thead>
          <tr>
            {((props.headers as string[]) ?? []).map((header, index) => (
              <th key={index}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {((props.rows as unknown[][]) ?? []).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {(Array.isArray(row) ? row : [row]).map((cell, cellIndex) => (
                <td key={cellIndex}>{renderNode(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ),
  List: ({ props, renderNode }) => {
    const Tag = props.ordered ? "ol" : "ul";
    return (
      <Tag className="oui-list">
        {((props.items as unknown[]) ?? []).map((item, index) => (
          <li key={index}>{renderNode(item)}</li>
        ))}
      </Tag>
    );
  },
  Callout: ({ props, renderNode }) => (
    <aside className={`oui-callout oui-${toneClass(props.tone)}`}>
      {props.title ? <strong>{text(props.title)}</strong> : null}
      <div>{renderNode(props.text)}</div>
    </aside>
  ),
  Progress: ({ props }) => {
    const max = Number(props.max) || 100;
    const percent = Math.min(100, Math.max(0, (Number(props.value) / max) * 100));
    return (
      <div className={`oui-progress oui-${toneClass(props.tone)}`}>
        <div className="oui-progress-label">
          <span>{text(props.label)}</span>
          <span>{Math.round(percent)}%</span>
        </div>
        <div className="oui-progress-track" role="progressbar" aria-valuenow={percent}>
          <div style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  },
  Link: ({ props }) => {
    const openUrl = use(OpenUrlContext);
    const url = text(props.url);
    return isWebUrl(url) ? (
      <a
        href={url}
        onClick={(event) => {
          // The host opens links; an in-place navigation would replace the app itself.
          event.preventDefault();
          openUrl(url);
        }}
      >
        {text(props.label)}
      </a>
    ) : (
      <span>{text(props.label)}</span>
    );
  },
  Image: ({ props }) => {
    const src = text(props.src);
    return /^(?:https?:|data:image\/)/i.test(src) ? (
      <img className="oui-image" src={src} alt={text(props.alt)} />
    ) : null;
  },
  Divider: () => <hr />,
  BarChart: ({ props }) => {
    const labels = (props.labels as string[]) ?? [];
    const values = (props.values as number[]) ?? [];
    const max = Math.max(...values, 0) || 1;
    return (
      <figure className="oui-chart">
        {props.title ? <figcaption>{text(props.title)}</figcaption> : null}
        <div className="oui-bars" role="img" aria-label={text(props.title)}>
          {values.map((value, index) => (
            <div key={index} className="oui-bar" aria-label={`${labels[index] ?? ""}: ${value}`}>
              <span className="oui-bar-value">{value}</span>
              <div style={{ height: `${(Math.max(0, value) / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="oui-axis">
          {labels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      </figure>
    );
  },
  LineChart,
  Series: () => null,
  Details: ({ props, renderNode }) => (
    <details className="oui-details" open={props.open === true}>
      <summary>{text(props.summary)}</summary>
      <div className="oui-stack oui-gap-m">{renderNode(props.children)}</div>
    </details>
  ),
  Tabs,
  Tab: ({ props, renderNode }) => (
    <div className="oui-stack oui-gap-m">{renderNode(props.children)}</div>
  ),
  Button,
  Input,
  Select,
  Checkbox,
  Slider,
};

const library = createLibrary({
  components: OPENUI_COMPONENT_SPECS.map((spec) =>
    defineComponent({ ...spec, component: RENDERERS[spec.name] }),
  ),
  root: OPENUI_ROOT,
});

const onError = (errors: OpenUIError[]) => {
  for (const error of errors) {
    console[error.severity === "warning" ? "warn" : "error"](
      `[openui] ${error.statementId ? `${error.statementId}: ` : ""}${error.message}`,
    );
  }
};

/** Renders an OpenUI program with T3's components. Needs OPENUI_CSS and the html_render theme variables. */
export function OpenUiView(props: {
  readonly source: string;
  readonly onOpenUrl: (url: string) => void;
  readonly onPrompt: (text: string) => void;
}) {
  const onAction = (event: ActionEvent) => {
    if (event.type === BuiltinActionType.OpenUrl) {
      const url = text(event.params.url);
      if (isWebUrl(url)) props.onOpenUrl(url);
    } else if (event.type === BuiltinActionType.ContinueConversation) {
      props.onPrompt(event.humanFriendlyMessage);
    }
  };
  return (
    <OpenUrlContext value={props.onOpenUrl}>
      <div className="openui">
        <Renderer response={props.source} library={library} onAction={onAction} onError={onError} />
      </div>
    </OpenUrlContext>
  );
}
