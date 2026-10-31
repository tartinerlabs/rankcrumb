"use client";

import {
  Alert,
  Button,
  Checkbox,
  CheckboxGroup,
  ComboBox,
  Description,
  Input,
  Label,
  ListBox,
  Modal,
  ScrollShadow,
  Skeleton,
  TextArea,
  TextField,
  Typography,
} from "@heroui/react";
import { Segment, Stepper } from "@heroui-pro/react";
import { useRouter } from "next/navigation";
import {
  Suspense,
  use,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { addAppAction } from "@/actions/apps";
import { createBrainstormAction } from "@/actions/brainstorms";
import { importCandidatesAction } from "@/actions/listing";
import { addTermsAction, setCountriesAction } from "@/actions/terms";
import { COUNTRIES, PRESET_COUNTRIES } from "@/components/countries";
import type { AppInfo } from "@/lib/itunes";
import { type SearchResult, searchApps } from "./actions";
import type { StartProgress } from "./data";

type Mode = "app" | "niche";

const DEBOUNCE_MS = 450;
const ratingsFormat = new Intl.NumberFormat("en-US");
// addTerms takes at most 100 keywords at a time
const MAX_IMPORT = 100;

// Presets first, then every other storefront by name
const COUNTRY_CHOICES = [
  ...PRESET_COUNTRIES.map((code) => COUNTRIES.find((c) => c.code === code)),
  ...COUNTRIES.filter(
    (c) => !(PRESET_COUNTRIES as readonly string[]).includes(c.code),
  ),
].filter((c) => c !== undefined);

export function StartScreen({
  progress,
}: {
  progress: Promise<StartProgress>;
}) {
  const [mode, setMode] = useState<Mode>("app");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-8 pb-12 sm:px-6 sm:pt-16">
      <Suspense fallback={<Skeleton className="h-10 w-64" />}>
        <Heading progress={progress} />
      </Suspense>
      <div className="flex flex-col gap-3">
        <div>
          <Segment
            aria-label="What to start with"
            selectedKey={mode}
            onSelectionChange={(key) => setMode(key as Mode)}
          >
            <Segment.Item id="app">Add an App</Segment.Item>
            <Segment.Item id="niche">Brainstorm a Niche</Segment.Item>
          </Segment>
        </div>
        {mode === "app" ? <AppSearch /> : <NicheForm />}
      </div>
      {mode === "app" && (
        <Suspense fallback={null}>
          <FirstRunSteps progress={progress} />
        </Suspense>
      )}
    </div>
  );
}

function Heading({ progress }: { progress: Promise<StartProgress> }) {
  const { hasApps } = use(progress);
  return (
    <Typography.Heading level={1}>
      {hasApps ? "Add an App" : "Add Your First App"}
    </Typography.Heading>
  );
}

function FirstRunSteps({ progress }: { progress: Promise<StartProgress> }) {
  const { step } = use(progress);
  if (step === null) return null;
  return (
    <Stepper currentStep={step}>
      {["Add Your App", "Pick Countries", "Add Keywords"].map((title) => (
        <Stepper.Step key={title}>
          <Stepper.Indicator />
          <Stepper.Content>
            <Stepper.Title>{title}</Stepper.Title>
          </Stepper.Content>
          <Stepper.Separator />
        </Stepper.Step>
      ))}
    </Stepper>
  );
}

function AppSearch() {
  const router = useRouter();
  const [input, setInput] = useState("");
  // Own app saved without countries: ask once before opening the workspace
  const [countriesFor, setCountriesFor] = useState<number | null>(null);
  const [result, setResult] = useState<SearchResult>({ apps: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [picked, setPicked] = useState<AppInfo | null>(null);
  // Results by trimmed term, so retyping a term costs no App Store call
  const cache = useRef(new Map<string, SearchResult>());
  const latest = useRef("");

  useEffect(() => {
    const term = input.trim();
    latest.current = term;
    // Picking a result fills the input with its name; that is not a new search
    if (picked && term === picked.name) return;
    if (term.length < 2) {
      setResult({ apps: [] });
      setIsSearching(false);
      return;
    }
    const cached = cache.current.get(term);
    if (cached) {
      setResult(cached);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchApps(term);
      if (!found.error) cache.current.set(term, found);
      if (latest.current !== term) return;
      setResult(found);
      setIsSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, picked]);

  const emptyText = isSearching
    ? "Searching the App Store…"
    : (result.error ??
      (input.trim().length < 2
        ? "Type at least 2 letters"
        : "No apps match that name"));

  return (
    <>
      <ComboBox
        aria-label="App name or App Store link"
        allowsEmptyCollection
        fullWidth
        inputValue={input}
        items={result.apps}
        menuTrigger="input"
        selectedKey={selectedKey}
        onInputChange={setInput}
        onSelectionChange={(key) => {
          setSelectedKey(typeof key === "number" ? key : null);
          const app = result.apps.find((a) => a.id === key);
          if (app) setPicked(app);
        }}
      >
        <ComboBox.InputGroup>
          <Input placeholder="App name or App Store link" />
          <ComboBox.Trigger />
        </ComboBox.InputGroup>
        <Description>
          Search covers the US store. Links from other stores work too.
        </Description>
        <ComboBox.Popover>
          <ListBox renderEmptyState={() => emptyText}>
            {(app: AppInfo) => (
              <ListBox.Item id={app.id} textValue={app.name}>
                <div className="flex min-w-0 items-center gap-3">
                  {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
                  <img
                    alt=""
                    className="size-10 shrink-0 rounded-xl"
                    height={40}
                    src={app.icon}
                    width={40}
                  />
                  <div className="flex min-w-0 flex-col">
                    <Label>{app.name}</Label>
                    <Description>
                      {app.developer} ·{" "}
                      <span className="tabular-nums">
                        {ratingsFormat.format(app.ratings)}
                      </span>{" "}
                      {app.ratings === 1 ? "rating" : "ratings"}
                    </Description>
                  </div>
                </div>
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
      <OwnerDialog
        app={picked}
        onClose={() => {
          setPicked(null);
          setSelectedKey(null);
        }}
        onAdded={(id, needsCountries) => {
          setPicked(null);
          setSelectedKey(null);
          if (needsCountries) setCountriesFor(id);
          else router.push(`/apps/${id}/board`);
        }}
      />
      <CountriesDialog
        appId={countriesFor}
        onDone={(id) => {
          setCountriesFor(null);
          router.push(`/apps/${id}/board`);
        }}
      />
    </>
  );
}

function OwnerDialog({
  app,
  onClose,
  onAdded,
}: {
  app: AppInfo | null;
  onClose: () => void;
  onAdded: (id: number, needsCountries: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [choice, setChoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = (isMine: boolean) => {
    if (!app) return;
    setChoice(isMine);
    setError(null);
    startTransition(async () => {
      const res = await addAppAction({
        id: app.id,
        country: app.country,
        mine: isMine,
      });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      onAdded(res.data.app.id, res.data.needsCountries);
    });
  };

  return (
    <Modal
      isOpen={app !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) {
          setError(null);
          onClose();
        }
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Is This Your App or a Competitor?</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {app && (
                <div className="flex min-w-0 items-center gap-3">
                  {/* biome-ignore lint/performance/noImgElement: tiny remote icon, no optimisation needed */}
                  <img
                    alt=""
                    className="size-12 shrink-0 rounded-xl"
                    height={48}
                    src={app.icon}
                    width={48}
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{app.name}</span>
                    <span className="truncate text-sm text-muted">
                      {app.developer}
                    </span>
                  </div>
                </div>
              )}
              {error && (
                <div className="mt-3">
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                </div>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isPending && choice !== false}
                isPending={isPending && choice === false}
                variant="outline"
                onPress={() => add(false)}
              >
                Competitor
              </Button>
              <Button
                isDisabled={isPending && choice !== true}
                isPending={isPending && choice === true}
                onPress={() => add(true)}
              >
                My App
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function CountriesDialog({
  appId,
  onDone,
}: {
  appId: number | null;
  onDone: (id: number) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [countries, setCountries] = useState<string[]>([...PRESET_COUNTRIES]);
  const [importListing, setImportListing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (appId === null) return;
    setError(null);
    startTransition(async () => {
      const saved = await setCountriesAction(appId, countries);
      if (saved.error !== undefined) {
        setError(saved.error);
        return;
      }
      if (importListing) {
        const found = await importCandidatesAction(appId);
        if (found.error !== undefined) {
          setError(found.error);
          return;
        }
        if (found.data.length > 0) {
          const added = await addTermsAction(appId, {
            labels: found.data.slice(0, MAX_IMPORT),
            localize: true,
          });
          if (added.error !== undefined) {
            setError(added.error);
            return;
          }
        }
      }
      onDone(appId);
    });
  };

  return (
    <Modal
      isOpen={appId !== null}
      onOpenChange={(open) => {
        // Closing skips the step; the workspace offers Add Country later
        if (!open && !isPending && appId !== null) onDone(appId);
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Pick Countries</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="flex flex-col gap-4">
                <CheckboxGroup
                  aria-label="Countries"
                  variant="secondary"
                  value={countries}
                  onChange={setCountries}
                >
                  <ScrollShadow className="max-h-64 overflow-y-auto">
                    <div className="flex flex-col gap-2">
                      {COUNTRY_CHOICES.map((c) => (
                        <Checkbox key={c.code} value={c.code}>
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span aria-hidden="true">{c.flag}</span> {c.name}
                          </Checkbox.Content>
                        </Checkbox>
                      ))}
                    </div>
                  </ScrollShadow>
                </CheckboxGroup>
                <Checkbox
                  variant="secondary"
                  isSelected={importListing}
                  onChange={setImportListing}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    Import keywords from my current listing
                  </Checkbox.Content>
                </Checkbox>
                {error && (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="tertiary"
                isDisabled={isPending}
                onPress={() => appId !== null && onDone(appId)}
              >
                Skip
              </Button>
              <Button
                isDisabled={countries.length === 0}
                isPending={isPending}
                onPress={save}
              >
                Save Countries
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function NicheForm() {
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const brainstorm = () => {
    setError(null);
    startTransition(async () => {
      const res = await createBrainstormAction({ idea });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      router.push(`/brainstorms/${res.data.id}`);
    });
  };

  return (
    <div className="flex flex-col items-start gap-3">
      <TextField fullWidth value={idea} onChange={setIdea}>
        <Label>Your Idea</Label>
        <TextArea
          placeholder="Describe the app you have in mind, e.g. a habit tracker for runners"
          rows={4}
        />
        <Description>
          AI suggests 15 to 25 keywords for the US store and checks them.
        </Description>
      </TextField>
      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}
      <Button
        isDisabled={idea.trim().length === 0}
        isPending={isPending}
        onPress={brainstorm}
      >
        Brainstorm Keywords
      </Button>
    </div>
  );
}
