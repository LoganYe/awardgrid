/**
 * TEST-ONLY: the `foundations` scenario — every base control of the real shell (src/components/ui), in every state,
 * on one page, for e2e/uiux/foundations.spec.ts and visual review. Not a production route: the host renders this
 * INSTEAD of the app, and the production bundle check fails on this file's markers.
 */
import { useState } from "react";
import { Button, Chip, IconButton, Notice, SegmentedControl, Sheet, Switch, TextField } from "../src/components/ui";

type View = "list" | "calendar" | "matrix";
type Cabin = "economy" | "premium" | "business";
type Sort = "miles" | "date" | "fees";

export function FoundationsGallery() {
  const [view, setView] = useState<View>("list");
  const [pressed, setPressed] = useState(true);
  const [open, setOpen] = useState(false);
  const [busyClicks, setBusyClicks] = useState(0);
  const [cabin, setCabin] = useState<Cabin>("economy");
  const [filter, setFilter] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sort, setSort] = useState<Sort>("miles");
  const [vanishing, setVanishing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nonstop, setNonstop] = useState(false);
  return (
    <main data-testid="foundations-page" className="fixture-foundations">
      <h1 className="fixture-foundations-title">Foundations (fixture, test only)</h1>

      <section className="fixture-foundations-group" aria-label="Buttons">
        <Button variant="primary" data-testid="primary-button-sample">
          Find award options
        </Button>
        <Button data-testid="secondary-button-sample">Keep editing</Button>
        <Button variant="quiet">Explain this option</Button>
        <Button variant="danger" data-testid="danger-button-sample">
          Remove key
        </Button>
        <Button variant="primary" disabled disabledReason="Add a departure date first" data-testid="disabled-button-sample">
          Find award options
        </Button>
        <div className="fixture-foundations-row">
          <Button variant="primary" data-testid="loading-button-idle">
            Apply and search
          </Button>
          <Button variant="primary" loading loadingLabel="Searching" data-testid="loading-button-busy" onClick={() => setBusyClicks((n) => n + 1)}>
            Apply and search
          </Button>
        </div>
        <p data-testid="busy-clicks">Busy clicks: {busyClicks}</p>
        <div className="fixture-foundations-row">
          <IconButton icon="close" label="Close sample" />
          <IconButton icon="close" label="Close sample (disabled)" disabled />
          <IconButton icon="close" label="Outlined sample" variant="outlined" />
          <IconButton icon="close" label="Outlined sample (disabled)" variant="outlined" disabled />
        </div>
      </section>

      <section className="fixture-foundations-group" aria-label="Chips and view switch">
        <div className="ag-chip-row">
          <Chip selected={pressed} onClick={() => setPressed((p) => !p)}>
            HKG Hong Kong
          </Chip>
          <Chip>Programs</Chip>
          <Chip>More filters</Chip>
          <Chip variant="filter" selected={filter} onClick={() => setFilter((f) => !f)}>
            Nonstop only
          </Chip>
          <Chip selected={false} disabled>
            Mixed cabin
          </Chip>
        </div>
        <SegmentedControl<View>
          label="Result view"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "calendar", label: "Calendar" },
            { value: "matrix", label: "Matrix" },
          ]}
        />
        <SegmentedControl<Cabin>
          label="Cabin"
          value={cabin}
          onChange={setCabin}
          options={[
            { value: "economy", label: "Economy" },
            { value: "premium", label: "Premium economy", disabled: true },
            { value: "business", label: "Business and first" },
          ]}
        />
      </section>

      <section className="fixture-foundations-group" aria-label="Switch">
        <div className="fixture-foundations-row">
          <label id="switch-sample-label" htmlFor="switch-sample">
            Nonstop only (sample)
          </label>
          <Switch id="switch-sample" aria-labelledby="switch-sample-label" checked={nonstop} onChange={setNonstop} />
        </div>
      </section>

      <section className="fixture-foundations-group" aria-label="Fields">
        <TextField label="Departure airports" help="Use 3-letter codes, e.g. HKG." defaultValue="HKG" data-testid="input-sample" />
        <TextField label="Return date" defaultValue="2026-02-30" error="2026-02-30 is not a real date." />
        <TextField label="Frequent flyer number" defaultValue="Locked" disabled data-testid="disabled-input-sample" />
      </section>

      <section className="fixture-foundations-group" aria-label="Notices">
        <Notice tone="info" data-testid="notice-info">
          Itinerary loaded. Check availability on the program site.
        </Notice>
        <Notice tone="warning" data-testid="notice-warning">
          Results are incomplete.
        </Notice>
        <Notice tone="danger" data-testid="notice-danger">
          The key was rejected.
        </Notice>
        <Notice tone="success" data-testid="notice-success">
          Baseline saved.
        </Notice>
      </section>

      <Button onClick={() => setSaved(true)}>Save sample</Button>
      {saved ? (
        <Notice tone="success" live data-testid="live-notice">
          Saved just now.
        </Notice>
      ) : null}

      <Button onClick={() => setOpen(true)}>Open sample sheet</Button>
      <Button onClick={() => setFilterOpen(true)}>Open filter sheet</Button>
      {vanishing ? null : <Button onClick={() => setVanishing(true)}>Open from a vanishing button</Button>}
      <Sheet open={vanishing} title="Vanishing opener" onClose={() => setVanishing(false)}>
        <p>The button that opened this is gone.</p>
      </Sheet>
      <Sheet open={filterOpen} title="Filter sheet" onClose={() => setFilterOpen(false)}>
        <TextField label="Search note" autoFocus />
        <SegmentedControl<Sort>
          label="Sort"
          value={sort}
          onChange={setSort}
          options={[
            { value: "miles", label: "Miles" },
            { value: "date", label: "Date" },
            { value: "fees", label: "Fees" },
          ]}
        />
      </Sheet>
      <Sheet open={open} title="Sample sheet" onClose={() => setOpen(false)}>
        <TextField label="Note" />
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </Sheet>
    </main>
  );
}
