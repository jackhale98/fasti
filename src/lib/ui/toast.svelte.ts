// SPDX-License-Identifier: GPL-2.0-or-later
/**
 * One toast at a time, announced politely. With `undo`, it offers an Undo
 * button and stays longer (6 s); otherwise 3.2 s, as in the prototype.
 */
export interface ToastMessage {
	id: number;
	text: string;
	undo?: () => void | Promise<void>;
}

class Toasts {
	current = $state<ToastMessage | null>(null);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#next = 1;

	show(text: string, undo?: ToastMessage['undo']) {
		clearTimeout(this.#timer);
		const message: ToastMessage = { id: this.#next++, text, undo };
		this.current = message;
		this.#timer = setTimeout(() => this.dismiss(message.id), undo ? 6000 : 3200);
	}

	dismiss(id?: number) {
		if (id === undefined || this.current?.id === id) this.current = null;
	}

	async runUndo() {
		const message = this.current;
		if (!message?.undo) return;
		this.dismiss(message.id);
		await message.undo();
	}
}

export const toasts = new Toasts();
