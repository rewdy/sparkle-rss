// @vitest-environment jsdom
import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmModal } from "../src/components/ConfirmModal";

const user = userEvent.setup();

afterEach(() => {
  cleanup();
});

function providers(ui: React.ReactNode) {
  return <MantineProvider>{ui}</MantineProvider>;
}

describe("ConfirmModal", () => {
  it("does not confirm when cancelled", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      providers(
        <ConfirmModal
          opened
          title="delete folder"
          onConfirm={onConfirm}
          onClose={onClose}
        >
          Delete &quot;tech&quot;?
        </ConfirmModal>,
      ),
    );
    await user.click(screen.getByRole("button", { name: "cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirms with the provided label", async () => {
    const onConfirm = vi.fn();
    render(
      providers(
        <ConfirmModal
          opened
          title="unsubscribe"
          confirmLabel="unsubscribe"
          onConfirm={onConfirm}
          onClose={() => {}}
        >
          Remove this feed?
        </ConfirmModal>,
      ),
    );
    await user.click(screen.getByRole("button", { name: "unsubscribe" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disables the confirm button while a destructive action is in flight", () => {
    render(
      providers(
        <ConfirmModal
          opened
          title="delete"
          loading
          onConfirm={() => {}}
          onClose={() => {}}
        >
          Go?
        </ConfirmModal>,
      ),
    );
    // While pending the confirm button is disabled so it can't be double-fires.
    expect(screen.getByRole("button", { name: "delete" })).toBeDisabled();
  });

  it("renders nothing meaningful content when closed", () => {
    render(
      providers(
        <ConfirmModal
          opened={false}
          title="delete"
          onConfirm={() => {}}
          onClose={() => {}}
        >
          hidden
        </ConfirmModal>,
      ),
    );
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
  });
});
