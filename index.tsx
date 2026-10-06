/*
 * LocalSpoiler - Vencord Plugin
 * Allows hiding messages under a spoiler or deleting them locally (like Telegram).
 * Author: Dovinch1k
 */

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { get, set } from "@api/DataStore";
import { updateMessage } from "@api/MessageUpdater";
import definePlugin from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { FluxDispatcher, Menu } from "@webpack/common";

const DATASTORE_KEY = "LocalSpoiler_HiddenMessages";

// Хранилище ID скрытых сообщений
let hiddenMessages = new Set<string>();

// Хранилище оригинального контента для восстановления
const originalData = new Map<string, { content: string; attachments: any[]; }>();

async function loadStore() {
    const saved = await get<string[]>(DATASTORE_KEY);
    if (saved && Array.isArray(saved)) {
        hiddenMessages = new Set(saved);
    }
}

async function saveStore() {
    await set(DATASTORE_KEY, Array.from(hiddenMessages));
}

function spoilerMessage(channelId: string, message: Message) {
    if (!originalData.has(message.id)) {
        originalData.set(message.id, {
            content: message.content ?? "",
            attachments: message.attachments ? [...message.attachments] : []
        });
    }

    hiddenMessages.add(message.id);
    saveStore();

    const original = originalData.get(message.id);
    const content = original?.content ? `||${original.content}||` : "||[Содержимое скрыто]||";
    const attachments = original?.attachments?.map(att => ({
        ...att,
        spoiler: true
    })) ?? [];

    updateMessage(channelId, message.id, {
        content,
        attachments
    });
}

function unhideMessage(channelId: string, message: Message) {
    hiddenMessages.delete(message.id);
    saveStore();

    const original = originalData.get(message.id);
    if (original) {
        updateMessage(channelId, message.id, {
            content: original.content,
            attachments: original.attachments
        });
        originalData.delete(message.id);
    } else {
        const stripped = message.content?.replace(/^\|\|([\s\S]*)\|\|$/, "$1") ?? "";
        updateMessage(channelId, message.id, {
            content: stripped
        });
    }
}

function deleteLocally(channelId: string, messageId: string) {
    FluxDispatcher.dispatch({
        type: "MESSAGE_DELETE",
        id: messageId,
        channelId: channelId
    });
}

const messageContextMenuPatch: NavContextMenuPatchCallback = (
    children,
    { channel, message }: { channel: Channel; message: Message; }
) => {
    if (!message || !channel) return;

    const isHidden = hiddenMessages.has(message.id);

    const spoilerItem = (
        <Menu.MenuItem
            id="local-spoiler-toggle"
            key="local-spoiler-toggle"
            label={isHidden ? "Показать сообщение (убрать спойлер)" : "Скрыть у себя (под спойлер)"}
            action={() => {
                if (isHidden) {
                    unhideMessage(channel.id, message);
                } else {
                    spoilerMessage(channel.id, message);
                }
            }}
        />
    );

    const deleteItem = (
        <Menu.MenuItem
            id="local-delete-toggle"
            key="local-delete-toggle"
            label="Удалить у себя (как в ТГ)"
            color="danger"
            action={() => deleteLocally(channel.id, message.id)}
        />
    );

    const group = findGroupChildrenByChildId("copy-text", children) ?? findGroupChildrenByChildId("delete", children);
    if (group) {
        const copyIdx = group.findIndex(c => c?.props?.id === "copy-text");
        if (copyIdx !== -1) {
            group.splice(copyIdx + 1, 0, spoilerItem, deleteItem);
        } else {
            group.push(spoilerItem, deleteItem);
        }
    } else {
        children.push(
            <Menu.MenuGroup label="Локальное скрытие">
                {spoilerItem}
                {deleteItem}
            </Menu.MenuGroup>
        );
    }
};

export default definePlugin({
    name: "LocalSpoiler",
    description: "Позволяет скрывать чужие сообщения под спойлер или удалять их только у себя (как в Telegram)",
    authors: [
        {
            name: "Dovinch1k",
            id: 0n
        }
    ],
    dependencies: ["MessageUpdaterAPI"],

    async start() {
        await loadStore();
    },

    stop() {
        hiddenMessages.clear();
        originalData.clear();
    },

    contextMenus: {
        "message": messageContextMenuPatch
    },

    flux: {
        LOAD_MESSAGES_SUCCESS(event: any) {
            if (!event?.messages || !Array.isArray(event.messages)) return;
            for (const msg of event.messages) {
                if (hiddenMessages.has(msg.id)) {
                    if (!originalData.has(msg.id)) {
                        originalData.set(msg.id, {
                            content: msg.content ?? "",
                            attachments: msg.attachments ? [...msg.attachments] : []
                        });
                    }
                    msg.content = msg.content ? `||${msg.content}||` : "||[Содержимое скрыто]||";
                    if (msg.attachments) {
                        msg.attachments = msg.attachments.map((a: any) => ({ ...a, spoiler: true }));
                    }
                }
            }
        }
    }
});
