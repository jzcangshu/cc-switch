import type * as React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Activity,
  BarChart3,
  ChevronDown,
  CircleDot,
  Copy,
  ListMinus,
  ListPlus,
  Loader2,
  Minus,
  MoreHorizontal,
  Pencil,
  Play,
  Plug,
  Plus,
  Power,
  PowerOff,
  Route,
  SquareTerminal,
  Star,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DisabledReason } from "@/components/ui/help-tip";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { CardButton, CardPresentation, CardTone } from "./presentation";

const DOT: Record<CardTone | "muted", string> = {
  direct: "bg-direct",
  route: "bg-route",
  stack: "bg-stack",
  neutral: "bg-fg-2",
  muted: "bg-fg-3",
};

/** 操作含义由第四版的卡片呈现模型决定，这里只负责按钮的文字与图标。 */
const BUTTON_ICON: Record<string, LucideIcon> = {
  switch: Play,
  exitAndUse: Plug,
  routeHere: Route,
  queueAdd: ListPlus,
  queueRemove: ListMinus,
  setDefault: Star,
  add: Plus,
  remove: Minus,
  enable: Power,
  use: Power,
  disable: PowerOff,
  openTerminal: SquareTerminal,
};

interface ProviderCardActionsProps {
  providerName: string;
  presentation: CardPresentation;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onTest?: () => void;
  isTesting?: boolean;
  onConfigureUsage?: () => void;
  onOpenTerminal?: () => void;
}

/**
 * 第三版的文字主按钮和常用操作栏。第四版新增的模式菜单与禁用原因继续使用原来的呈现模型。
 */
export function ProviderCardActions({
  providerName,
  presentation,
  onEdit,
  onDelete,
  onDuplicate,
  onTest,
  isTesting,
  onConfigureUsage,
  onOpenTerminal,
}: ProviderCardActionsProps) {
  const { t } = useTranslation();
  const { status, buttons, move, menuItems = [] } = presentation;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {status && (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-subtle px-3 py-2 text-sm font-medium text-fg-1">
          <span
            aria-hidden="true"
            className={cn("h-1.5 w-1.5 rounded-full", DOT[status.dot])}
          />
          {status.label}
        </span>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1 transition-opacity duration-200 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        {buttons.map((button) => (
          <PrimaryButton key={button.key} button={button} />
        ))}

        {move && (
          <div className="flex items-center">
            <HoverTip
              content={t("providerCard.action.moveUp", { name: providerName })}
            >
              <Button
                variant="quiet"
                size="icon"
                aria-label={t("providerCard.action.moveUp", {
                  name: providerName,
                })}
                disabled={!move.onUp}
                onClick={move.onUp}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </HoverTip>
            <HoverTip
              content={t("providerCard.action.moveDown", {
                name: providerName,
              })}
            >
              <Button
                variant="quiet"
                size="icon"
                aria-label={t("providerCard.action.moveDown", {
                  name: providerName,
                })}
                disabled={!move.onDown}
                onClick={move.onDown}
              >
                <ArrowDown className="h-4 w-4" strokeWidth={1.5} />
              </Button>
            </HoverTip>
          </div>
        )}

        <IconAction
          tip={t("common.edit")}
          disabledReason={presentation.editDisabledReason}
        >
          <Button
            variant="quiet"
            size="icon"
            aria-label={t("providerCard.action.edit", { name: providerName })}
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.5} />
          </Button>
        </IconAction>

        {onDuplicate && (
          <HoverTip content={t("provider.duplicate")}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("provider.duplicate")}
              onClick={onDuplicate}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </HoverTip>
        )}
        {onTest && (
          <HoverTip content={t("provider.connectivityCheck")}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("provider.connectivityCheck")}
              disabled={isTesting}
              onClick={onTest}
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Activity className="h-4 w-4" />
              )}
            </Button>
          </HoverTip>
        )}
        {onConfigureUsage && (
          <HoverTip content={t("provider.configureUsage")}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("provider.configureUsage")}
              onClick={onConfigureUsage}
            >
              <BarChart3 className="h-4 w-4" />
            </Button>
          </HoverTip>
        )}
        {onOpenTerminal && (
          <HoverTip content={t("provider.openTerminal")}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("provider.openTerminal")}
              onClick={onOpenTerminal}
              className="hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              <SquareTerminal className="h-4 w-4" />
            </Button>
          </HoverTip>
        )}
        <IconAction
          tip={t("common.delete")}
          disabledReason={presentation.deleteDisabledReason}
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("common.delete")}
            onClick={onDelete}
            className="hover:text-red-500 dark:hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </IconAction>

        {menuItems.length > 0 && (
          <DropdownMenu>
            <HoverTip content={t("common.more")}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="quiet"
                  size="icon"
                  aria-label={t("providerCard.action.more", {
                    name: providerName,
                  })}
                >
                  <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                </Button>
              </DropdownMenuTrigger>
            </HoverTip>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {menuItems.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  disabled={Boolean(item.disabledReason)}
                  onSelect={item.onSelect}
                  className="flex-col items-start gap-0.5"
                >
                  {item.label}
                  {item.disabledReason && (
                    <span className="max-w-64 text-caption text-fg-3">
                      {item.disabledReason}
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}

/** 有禁用原因时只挂说明卡（报原因），否则挂 HoverTip（报名字），两者不叠。 */
function IconAction({
  tip,
  disabledReason,
  children,
}: {
  tip: string;
  disabledReason?: string;
  children: React.ReactElement;
}) {
  if (disabledReason) {
    return (
      <DisabledReason reason={disabledReason} align="end">
        {children}
      </DisabledReason>
    );
  }
  return <HoverTip content={tip}>{children}</HoverTip>;
}

function PrimaryButton({ button }: { button: CardButton }) {
  const Icon = BUTTON_ICON[button.key] ?? CircleDot;
  const icon = <Icon className="h-4 w-4" strokeWidth={1.5} />;
  const className = cn(
    "h-8 min-w-[4.5rem] rounded-lg px-2.5",
    (button.key === "routeHere" || button.key === "queueAdd") &&
      "bg-emerald-500 text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700",
    (button.key === "remove" ||
      button.key === "queueRemove" ||
      button.key === "disable") &&
      "bg-orange-100 text-orange-600 hover:bg-orange-200 dark:bg-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-900/70",
  );
  if (button.menu && !button.disabledReason) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="default"
            size="sm"
            aria-label={button.label}
            className={className}
          >
            {icon}
            {button.label}
            <ChevronDown className="h-3 w-3 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-72 min-w-64 overflow-y-auto"
        >
          <DropdownMenuLabel>{button.menu.title}</DropdownMenuLabel>
          {button.menu.options.map((option) => (
            <DropdownMenuItem
              key={option.key}
              onSelect={option.onSelect}
              className="flex min-w-0 flex-col items-start gap-0.5"
            >
              <span className="max-w-72 truncate">{option.label}</span>
              {option.detail && (
                <span className="max-w-72 truncate font-mono text-caption text-fg-3">
                  {option.detail}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <DisabledReason reason={button.disabledReason} align="end">
      <Button
        variant="default"
        size="sm"
        className={className}
        aria-label={button.label}
        onClick={button.onClick}
      >
        {icon}
        {button.label}
      </Button>
    </DisabledReason>
  );
}
