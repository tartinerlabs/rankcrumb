"use client";

import {
  AlertDialog,
  Button,
  buttonVariants,
  Description,
  Dropdown,
  ExternalLinkIcon,
  Label,
  Tooltip,
  toast,
} from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Link } from "react-aria-components/Link";
import {
  removeAppAction,
  restoreAppAction,
  updateAppAction,
} from "@/actions/apps";
import { GearIcon, StarIcon } from "@/components/icons";
import type { Schedule } from "@/db/schema";

const SCHEDULE_LABELS: Record<Schedule, string> = {
  off: "Off",
  daily: "Daily",
  weekly: "Weekly",
};

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

function languageLabel(code: string): string {
  try {
    return languageNames.of(code) ?? code;
  } catch {
    return code;
  }
}

type Props = {
  trackId: number;
  name: string;
  storefront: string;
  isMine: boolean;
  schedule: Schedule;
  language: string;
  /** Listing languages the app can use as its main one */
  languages: string[];
};

export function HeaderActions({
  trackId,
  name,
  storefront,
  isMine,
  schedule,
  language,
  languages,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [isRemoveOpen, setIsRemoveOpen] = useState(false);
  const [isRemoving, startRemove] = useTransition();
  const markLabel = isMine ? "Mark as competitor" : "Mark as mine";

  const update = (
    patch: { schedule?: Schedule; language?: string; mine?: boolean },
    done?: () => void,
  ) => {
    startTransition(async () => {
      const res = await updateAppAction(trackId, patch);
      if (res.error !== undefined) toast.danger(res.error);
      else done?.();
    });
  };

  const toggleMine = () => {
    const mine = !isMine;
    update({ mine }, () => {
      const id = toast(mine ? "Marked as mine" : "Marked as competitor", {
        actionProps: {
          children: "Undo",
          onPress: () => {
            toast.close(id);
            update({ mine: !mine });
          },
        },
      });
    });
  };

  const remove = () => {
    startRemove(async () => {
      const res = await removeAppAction(trackId);
      if (res.error !== undefined) {
        toast.danger(res.error);
        return;
      }
      setIsRemoveOpen(false);
      // Closing first stops a second Undo from restoring twice
      const id = toast(`Removed ${name}`, {
        actionProps: {
          children: "Undo",
          onPress: async () => {
            toast.close(id);
            const undo = await restoreAppAction(trackId);
            if (undo.error !== undefined) toast.danger(undo.error);
            else router.push(`/apps/${trackId}/board`);
          },
        },
      });
      router.push("/");
    });
  };

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <Link
          href={`https://apps.apple.com/${storefront}/app/id${trackId}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open on the App Store"
          className={buttonVariants({
            variant: "ghost",
            isIconOnly: true,
          })}
        >
          <ExternalLinkIcon />
        </Link>
        <Tooltip.Content>Open on the App Store</Tooltip.Content>
      </Tooltip>

      <Tooltip>
        <Button
          isIconOnly
          variant="ghost"
          aria-label={markLabel}
          onPress={toggleMine}
        >
          <StarIcon fill={isMine ? "currentColor" : "none"} />
        </Button>
        <Tooltip.Content>{markLabel}</Tooltip.Content>
      </Tooltip>

      <Dropdown>
        <Tooltip>
          <Button isIconOnly variant="ghost" aria-label="Settings">
            <GearIcon />
          </Button>
          <Tooltip.Content>Settings</Tooltip.Content>
        </Tooltip>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            aria-label="App settings"
            onAction={(key) => {
              if (key === "remove") setIsRemoveOpen(true);
            }}
          >
            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="schedule" textValue="Check schedule">
                <Label>Check schedule</Label>
                <Description>{SCHEDULE_LABELS[schedule]}</Description>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="Check schedule"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[schedule]}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0] as Schedule | undefined;
                    if (next && next !== schedule) update({ schedule: next });
                  }}
                >
                  {(Object.keys(SCHEDULE_LABELS) as Schedule[]).map((key) => (
                    <Dropdown.Item
                      key={key}
                      id={key}
                      textValue={SCHEDULE_LABELS[key]}
                    >
                      <Label>{SCHEDULE_LABELS[key]}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>

            <Dropdown.SubmenuTrigger>
              <Dropdown.Item id="language" textValue="Main listing language">
                <Label>Main listing language</Label>
                <Description>{languageLabel(language)}</Description>
                <Dropdown.SubmenuIndicator />
              </Dropdown.Item>
              <Dropdown.Popover>
                <Dropdown.Menu
                  aria-label="Main listing language"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[language]}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (typeof next === "string" && next !== language) {
                      update({ language: next });
                    }
                  }}
                >
                  {languages.map((code) => (
                    <Dropdown.Item
                      key={code}
                      id={code}
                      textValue={languageLabel(code)}
                    >
                      <Label>{languageLabel(code)}</Label>
                      <Dropdown.ItemIndicator />
                    </Dropdown.Item>
                  ))}
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown.SubmenuTrigger>

            <Dropdown.Item id="remove" textValue="Remove app" variant="danger">
              <Label>Remove app</Label>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>

      <AlertDialog>
        <AlertDialog.Backdrop
          isOpen={isRemoveOpen}
          onOpenChange={(open) => {
            if (!isRemoving) setIsRemoveOpen(open);
          }}
        >
          <AlertDialog.Container>
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>Remove {name}?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                Its keywords and competitors leave your workspace. Past checks
                are kept.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="tertiary"
                  isDisabled={isRemoving}
                  onPress={() => setIsRemoveOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  isPending={isRemoving}
                  onPress={remove}
                >
                  Remove App
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </div>
  );
}
