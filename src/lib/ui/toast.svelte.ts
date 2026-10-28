// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One toast at a time, announced politely. With `undo`, it offers an Undo
 * button and stays longer (6 s); otherwise 3.2 s, as in the prototype. A
 * toast with an `action` (e.g. "Reload" for a new version) stays until it is
 * used or replaced.
 */
export interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

export interface ToastMessage {
	id: number;
	text: string;
	action?: ToastAction;
}

class Toasts {
	current = $state<ToastMessage | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#next = 1;

	/** A toast, with Undo when `undo` is given. */
	show(text: string, undo?: () => void | Promise<void>) {
		this.#show(text, undo ? { label: 'Undo', run: undo } : undefined, undo ? 6000 : 3200);
	}

	/** A toast with a button that stays until it is used or replaced. */
	offer(text: string, action: ToastAction) {
		this.#show(text, action, null);
	}

	#show(text: string, action: ToastAction | undefined, ms: number | null) {
		clearTimeout(this.#timer);
		const message: ToastMessage = { id: this.#next++, text, action };
		this.current = message;
		if (ms !== null) this.#timer = setTimeout(() => this.dismiss(message.id), ms);
	}

	dismiss(id?: number) {
		if (id === undefined || this.current?.id === id) this.current = null;
	}

	async runAction() {
		const message = this.current;
		if (!message?.action) return;
		this.dismiss(message.id);
		await message.action.run();
	}
}

export const toasts = new Toasts();
