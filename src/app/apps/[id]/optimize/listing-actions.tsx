"use client";

import {
  Alert,
  Button,
  Description,
  Dropdown,
  Input,
  Label,
  Modal,
  TextField,
  toast,
} from "@heroui/react";
import { useState, useTransition } from "react";
import { saveListingDraftAction } from "@/actions/listing";
import type { ListingText } from "@/db/schema";

export type Draft = { locale: string } & ListingText;

export type ExportData = {
  drafts: Draft[];
  promotionalText: string;
  description: string;
};

function asText({ drafts, promotionalText, description }: ExportData) {
  const blocks = drafts.map((d) =>
    [
      d.locale,
      `Name: ${d.name}`,
      `Subtitle: ${d.subtitle}`,
      `Keywords: ${d.keywords}`,
    ].join("\n"),
  );
  if (promotionalText) blocks.push(`Promotional Text:\n${promotionalText}`);
  if (description) blocks.push(`Description:\n${description}`);
  return blocks.join("\n\n");
}

function asJson({ drafts, promotionalText, description }: ExportData) {
  const locales = Object.fromEntries(
    drafts.map(({ locale, ...listing }) => [locale, listing]),
  );
  return JSON.stringify({ locales, promotionalText, description }, null, 2);
}

/** Copy the listing to the clipboard as plain text or JSON. */
export function ExportMenu({ data }: { data: () => ExportData }) {
  const copy = async (format: "text" | "json") => {
    try {
      await navigator.clipboard.writeText(
        format === "json" ? asJson(data()) : asText(data()),
      );
      toast.success(format === "json" ? "Copied as JSON" : "Copied as text");
    } catch {
      toast.danger("Could not copy to the clipboard");
    }
  };

  return (
    <Dropdown>
      <Button variant="outline">Export</Button>
      <Dropdown.Popover placement="bottom end">
        <Dropdown.Menu
          aria-label="Export listing"
          onAction={(key) => copy(key === "json" ? "json" : "text")}
        >
          <Dropdown.Item id="text" textValue="Copy as Text">
            <Label>Copy as Text</Label>
          </Dropdown.Item>
          <Dropdown.Item id="json" textValue="Copy as JSON">
            <Label>Copy as JSON</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

type SaveProps = {
  appId: number;
  drafts: () => Draft[];
  /** Version in Prepare for Submission, when App Store Connect reported one */
  version: string | null;
  /** Missing App Store Connect variables; null when connected */
  missingEnv: string[] | null;
  isPrimary: boolean;
  isDisabled: boolean;
};

/**
 * Save name, subtitle and keyword field to the next iOS version in App Store
 * Connect as a draft. Never submits for review.
 */
export function SaveToAppStoreConnect({
  appId,
  drafts,
  version,
  missingEnv,
  isPrimary,
  isDisabled,
}: SaveProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [versionString, setVersionString] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const list = isOpen ? drafts() : [];

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveListingDraftAction({
        appId,
        confirmed: true,
        versionString: version ? null : versionString,
        drafts: list,
      });
      if (res.error !== undefined) {
        setError(res.error);
        return;
      }
      setIsOpen(false);
      toast.success("Saved to App Store Connect", {
        description: res.data.message,
      });
    });
  };

  return (
    <>
      <Button
        variant={isPrimary ? "primary" : "outline"}
        isDisabled={isDisabled}
        onPress={() => setIsOpen(true)}
      >
        Save to App Store Connect
      </Button>
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!isPending) {
            setIsOpen(open);
            setError(null);
          }
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>
                  {missingEnv
                    ? "Connect App Store Connect"
                    : "Save as a Draft Version?"}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {missingEnv ? (
                  <div className="flex flex-col gap-3 text-sm">
                    <p>
                      Create an API key in App Store Connect under Users and
                      Access, Integrations, with the App Manager role. Then add
                      these to <code>.env.local</code> and restart the app:
                    </p>
                    <ul className="flex flex-col gap-1">
                      {missingEnv.map((name) => (
                        <li key={name}>
                          <code>{name}</code>
                        </li>
                      ))}
                    </ul>
                    <p className="text-muted">
                      The private key is the .p8 file, base64-encoded or pasted
                      with \n line breaks.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-4">
                    <p className="text-sm">
                      {version
                        ? `Writes ${list.length} ${list.length === 1 ? "locale" : "locales"} to version ${version}, which is in Prepare for Submission.`
                        : `Writes ${list.length} ${list.length === 1 ? "locale" : "locales"} to the iOS version in Prepare for Submission, or creates it.`}{" "}
                      Nothing is submitted for review.
                    </p>
                    {!version && (
                      <TextField
                        fullWidth
                        value={versionString}
                        onChange={setVersionString}
                      >
                        <Label>New Version Number</Label>
                        <Input placeholder="1.2.0" />
                        <Description>
                          Only used when no version is in Prepare for Submission
                        </Description>
                      </TextField>
                    )}
                    {error && (
                      <Alert status="danger">
                        <Alert.Indicator />
                        <Alert.Content>
                          <Alert.Description>{error}</Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                {missingEnv ? (
                  <Button variant="tertiary" onPress={() => setIsOpen(false)}>
                    Close
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="tertiary"
                      isDisabled={isPending}
                      onPress={() => setIsOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button isPending={isPending} onPress={save}>
                      Save Draft
                    </Button>
                  </>
                )}
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  );
}
