import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderCardActions } from "@/components/providers/ProviderCardActions";
import type { CardPresentation } from "@/components/providers/presentation";

async function openMenu(presentation: CardPresentation) {
  const user = userEvent.setup();
  render(
    <ProviderCardActions
      providerName="Kimi"
      presentation={presentation}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "providerCard.action.more" }),
  );
  return { user, menu: await screen.findByRole("menu") };
}

describe("ProviderCardActions — mode items in the more menu", () => {
  it("lists them first", async () => {
    const onSelect = vi.fn();
    const { user, menu } = await openMenu({
      buttons: [],
      chips: [],
      menuItems: [
        {
          key: "setDefault",
          label: "providerCard.action.setDefault",
          onSelect,
        },
      ],
    });

    const items = within(menu).getAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("providerCard.action.setDefault");
    expect(items).toHaveLength(1);
    await user.click(items[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "provider.duplicate" }),
    ).toBeInTheDocument();
  });

  it("keeps a disabled one listed with its reason", async () => {
    const onSelect = vi.fn();
    const { user, menu } = await openMenu({
      buttons: [],
      chips: [],
      menuItems: [
        {
          key: "setDefault",
          label: "providerCard.action.setDefault",
          disabledReason: "providerCard.reason.defaultWhileRouting",
          onSelect,
        },
      ],
    });

    const item = within(menu).getAllByRole("menuitem")[0];
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(item).toHaveTextContent("providerCard.reason.defaultWhileRouting");
    await user.click(item);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("exposes every common action directly without a more menu", async () => {
    const user = userEvent.setup();
    const actions = {
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onDuplicate: vi.fn(),
      onTest: vi.fn(),
      onConfigureUsage: vi.fn(),
      onOpenTerminal: vi.fn(),
    };
    render(
      <ProviderCardActions
        providerName="Kimi"
        presentation={{ buttons: [], chips: [] }}
        {...actions}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "providerCard.action.more" }),
    ).not.toBeInTheDocument();
    for (const [label, callback] of [
      ["providerCard.action.edit", actions.onEdit],
      ["provider.duplicate", actions.onDuplicate],
      ["provider.connectivityCheck", actions.onTest],
      ["provider.configureUsage", actions.onConfigureUsage],
      ["provider.openTerminal", actions.onOpenTerminal],
      ["common.delete", actions.onDelete],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(callback).toHaveBeenCalledTimes(1);
    }
  });

  it("keeps disabled direct actions focusable and explains why they cannot run", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <ProviderCardActions
        providerName="Managed"
        presentation={{
          chips: [],
          buttons: [
            {
              key: "switch",
              label: "Switch provider",
              onClick: onSwitch,
              disabledReason: "Needs routing",
            },
          ],
          editDisabledReason: "Managed externally",
          deleteDisabledReason: "Currently active",
        }}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    for (const [label, reason] of [
      ["Switch provider", "Needs routing"],
      ["providerCard.action.edit", "Managed externally"],
      ["common.delete", "Currently active"],
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(reason);
      await user.click(button);
    }
    expect(onSwitch).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("uses a visible text switch button and keeps connectivity testing disabled while running", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    const onTest = vi.fn();
    render(
      <ProviderCardActions
        providerName="Kimi"
        presentation={{
          chips: [],
          buttons: [
            { key: "switch", label: "Switch provider", onClick: onSwitch },
          ],
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onTest={onTest}
        isTesting
      />,
    );
    const button = screen.getByRole("button", { name: "Switch provider" });
    expect(button).toHaveTextContent("Switch provider");
    await user.click(button);
    expect(onSwitch).toHaveBeenCalledTimes(1);
    const testButton = screen.getByRole("button", {
      name: "provider.connectivityCheck",
    });
    expect(testButton).toBeDisabled();
    await user.click(testButton);
    expect(onTest).not.toHaveBeenCalled();
  });

  it("keeps model selection and failover queue movement wired to their exact handlers", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDown = vi.fn();
    render(
      <ProviderCardActions
        providerName="Kimi"
        presentation={{
          chips: [],
          move: { onDown },
          buttons: [
            {
              key: "setDefault",
              label: "Set default",
              onClick: vi.fn(),
              menu: {
                title: "Choose model",
                options: [
                  {
                    key: "model-a",
                    label: "Model A",
                    detail: "model-a",
                    onSelect,
                  },
                ],
              },
            },
          ],
        }}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "providerCard.action.moveUp" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "providerCard.action.moveDown" }),
    );
    expect(onDown).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Set default" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Model A model-a" }),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
