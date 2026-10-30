/** Component styles, scoped by class prefix; colors come from the html_render theme variables. */
export const OPENUI_CSS = `
.openui{display:flex;flex-direction:column;gap:12px;min-width:0}
.openui h1,.openui h2,.openui h3{margin:0;line-height:1.3}.openui h1{font-size:20px}.openui h2{font-size:17px}.openui h3{font-size:15px}
.openui p{margin:0}.oui-text-muted{color:var(--muted-foreground)}.oui-text-strong{font-weight:600}
.oui-stack{display:flex;flex-direction:column;min-width:0}.oui-stack.oui-row{flex-direction:row;flex-wrap:wrap;align-items:center}
.oui-stack.oui-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr))}
.oui-gap-s{gap:6px}.oui-gap-m{gap:12px}.oui-gap-l{gap:20px}
.oui-card{background:var(--card);color:var(--card-foreground);border:1px solid var(--border);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.oui-tone-neutral{--tone:var(--muted-foreground);--tone-surface:var(--muted)}
.oui-tone-info{--tone:var(--info-foreground);--tone-surface:color-mix(in srgb,var(--info) 14%,transparent)}
.oui-tone-success{--tone:var(--success-foreground);--tone-surface:color-mix(in srgb,var(--success) 14%,transparent)}
.oui-tone-warning{--tone:var(--warning-foreground);--tone-surface:var(--warning-surface)}
.oui-tone-danger{--tone:var(--destructive-foreground);--tone-surface:var(--destructive-surface)}
.oui-tone-accent{--tone:var(--accent-surface-foreground);--tone-surface:var(--accent-surface)}
.oui-stat{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:12px 16px;display:flex;flex-direction:column;gap:2px;min-width:0}
.oui-stat-label{color:var(--muted-foreground);font-size:12px}.oui-stat-value{font-size:22px;font-weight:600;line-height:1.2}
.oui-stat:not(.oui-tone-neutral) .oui-stat-value{color:var(--tone)}.oui-stat-detail{color:var(--muted-foreground);font-size:12px}
.oui-badge{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:500;color:var(--tone);background:var(--tone-surface);white-space:nowrap}
.oui-table{overflow-x:auto;border:1px solid var(--border);border-radius:var(--radius)}
.oui-table table{border-collapse:collapse;width:100%}.oui-table th,.oui-table td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);vertical-align:top}
.oui-table th{font-weight:500;color:var(--muted-foreground);font-size:12px;background:var(--muted)}.oui-table tr:last-child td{border-bottom:0}
.oui-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}
.oui-callout{border-left:3px solid var(--tone);background:var(--tone-surface);border-radius:var(--radius);padding:12px 16px;display:flex;flex-direction:column;gap:4px}
.oui-callout.oui-tone-neutral{border-left-color:var(--border)}
.oui-progress{display:flex;flex-direction:column;gap:4px}.oui-progress-label{display:flex;justify-content:space-between;font-size:12px;color:var(--muted-foreground)}
.oui-progress-track{height:6px;border-radius:999px;background:var(--muted);overflow:hidden}.oui-progress-track>div{height:100%;background:var(--accent);border-radius:inherit}
.oui-progress:not(.oui-tone-neutral) .oui-progress-track>div{background:var(--tone)}
.openui a{color:var(--accent)}.oui-image{max-width:100%;border-radius:var(--radius)}
.openui hr{border:0;border-top:1px solid var(--border);margin:0;width:100%}
.oui-code{margin:0;padding:12px 16px;border-radius:var(--radius);background:var(--code-background);color:var(--code-foreground);overflow-x:auto;font-size:12.5px}
.oui-chart{margin:0;display:flex;flex-direction:column;gap:8px}.oui-chart figcaption{font-weight:500}
.oui-chart svg{width:100%;height:180px;display:block}
.oui-bars{height:180px;display:flex;align-items:flex-end;gap:6px}.oui-bar{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;min-width:0}
.oui-bar>div{width:100%;background:var(--chart-1);border-radius:4px 4px 0 0;min-height:1px}.oui-bar-value{font-size:11px;color:var(--muted-foreground)}
.oui-axis{display:flex;justify-content:space-between;gap:6px;font-size:11px;color:var(--muted-foreground)}.oui-bars+.oui-axis>span{flex:1;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.oui-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:12px}.oui-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.oui-details{border:1px solid var(--border);border-radius:var(--radius);padding:8px 16px}.oui-details summary{cursor:pointer;font-weight:500}.oui-details[open] summary{margin-bottom:12px}
.oui-tabs [role=tablist]{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:12px}
.oui-tabs [role=tab]{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted-foreground);padding:6px 10px;font:inherit;cursor:pointer}
.oui-tabs [role=tab][aria-selected=true]{color:var(--foreground);border-bottom-color:var(--accent)}
.oui-button{font:inherit;font-weight:500;border-radius:calc(var(--radius) - 2px);padding:6px 14px;cursor:pointer;border:1px solid transparent;align-self:flex-start}
.oui-button-primary{background:var(--primary);color:var(--primary-foreground)}.oui-button-secondary{background:var(--secondary);color:var(--secondary-foreground);border-color:var(--border)}
.oui-button-ghost{background:transparent;color:var(--foreground)}.oui-button-danger{background:var(--destructive);color:#fff}
.oui-field{font:inherit;color:var(--foreground);background:var(--background);border:1px solid var(--input);border-radius:calc(var(--radius) - 2px);padding:6px 10px;min-width:0}
.oui-check{display:inline-flex;gap:8px;align-items:center}.oui-slider{display:flex;gap:12px;align-items:center}.oui-slider input{flex:1;accent-color:var(--accent)}
`;
