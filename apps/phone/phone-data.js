/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 * 
 * ⚠️ 版权声明 (Copyright Notice):
 * 1. 禁止商业化：本项目仅供交流学习，严禁任何形式的倒卖、盈利等商业行为。
 * 2. 禁止二改发布：严禁未经授权修改代码后作为独立项目二次发布或分发。
 * 3. 禁止抄袭：严禁盗用本项目的核心逻辑、UI设计与相关原代码。
 * 
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */
// ========================================
// 通话记录数据层
// ========================================

export function parseSmsMessagesFromText(text = '') {
    const source = String(text || '');
    if (!source) return [];

    const messages = [];
    // 标签必须独占一行，避免把思考区里的“生成 <短信> 标签”误识别为真实内容。
    const tagPattern = /^[ \t]*<\s*短信\s*>[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*<\s*\/\s*短信\s*>[ \t]*$/gim;
    let tagMatch;
    while ((tagMatch = tagPattern.exec(source)) !== null) {
        const sections = String(tagMatch[1] || '').split(/\r?\n[ \t]*(?:-{3,}|—{2,}|–{3,})[ \t]*\r?\n/);
        sections.forEach((section, sectionIndex) => {
            const senderMatch = section.match(/^\s*\[([^\]\r\n]+)\]\s*(?:\r?\n|$)/);
            if (!senderMatch) return;

            const body = section.slice(senderMatch[0].length);
            const contentMatch = body.match(/^\s*([\s\S]*?)\s*(?:\r?\n)+\s*发送时间\s*[:：]\s*(?:(\d{1,6})\s*(?:年|[-/.])\s*(0?[1-9]|1[0-2])\s*(?:月|[-/.])\s*(0?[1-9]|[12]\d|3[01])\s*日?\s*)?([01]?\d|2[0-3])\s*[:：]\s*([0-5]\d)\s*$/);
            const sender = String(senderMatch[1] || '').trim();
            const content = String(contentMatch?.[1] || '')
                .replace(/^\s*内容\s*[:：]\s*/, '')
                .trim();
            if (!sender || !content || !contentMatch) return;

            const year = String(contentMatch[2] || '');
            const date = year
                ? `${year.padStart(4, '0')}年${String(contentMatch[3]).padStart(2, '0')}月${String(contentMatch[4]).padStart(2, '0')}日`
                : '';

            messages.push({
                sender,
                text: content,
                date,
                time: `${contentMatch[5].padStart(2, '0')}:${contentMatch[6]}`,
                sourceIndex: tagMatch.index + sectionIndex
            });
        });
    }
    return messages;
}

export class PhoneCallData {
    constructor(storage) {
        this.storage = storage;
        this._callHistory = null; // Lazy-loaded
        this._contacts = null;
        this._smsConversations = null;
        this._smsProcessedBatches = null;
    }

    // 获取通话记录（lazy load）
    getCallHistory() {
        if (!this._callHistory) {
            const saved = this.storage.get('phone_call_history', null);
            if (saved) {
                try {
                    this._callHistory = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话记录失败:', e);
                    this._callHistory = [];
                }
            } else {
                this._callHistory = [];
            }
        }
        return this._callHistory;
    }

    // 添加通话记录
    // record: { id, caller, time, date, weekday, duration(秒), status('missed'|'answered'|'rejected'), transcript[] }
    addCallRecord(record) {
        const history = this.getCallHistory();
        history.push(record);
        this.saveCallHistory();
    }

    // 删除通话记录
    deleteCallRecord(id) {
        const history = this.getCallHistory();
        const idx = history.findIndex(r => r.id === id);
        if (idx !== -1) {
            history.splice(idx, 1);
            this.saveCallHistory();
            return true;
        }
        return false;
    }

    // 保存通话记录
    saveCallHistory() {
        if (this._callHistory) {
            this.storage.set('phone_call_history', this._callHistory);
        }
    }

    getContacts() {
        if (!this._contacts) {
            const saved = this.storage.get('phone_call_contacts', null);
            if (saved) {
                try {
                    this._contacts = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析通话联系人失败:', e);
                    this._contacts = [];
                }
            } else {
                this._contacts = [];
            }
        }
        return Array.isArray(this._contacts) ? this._contacts : [];
    }

    saveContacts() {
        this.storage.set('phone_call_contacts', this.getContacts());
    }

    addContact(name) {
        const safeName = String(name || '').trim();
        if (!safeName) return null;
        const contacts = this.getContacts();
        const exists = contacts.find(item => String(item?.name || '').trim() === safeName);
        if (exists) return exists;

        const contact = {
            id: `phone_contact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: safeName,
            createdAt: Date.now()
        };
        contacts.push(contact);
        this.saveContacts();
        return contact;
    }

    deleteContact(id) {
        const safeId = String(id || '').trim();
        if (!safeId) return false;
        const contacts = this.getContacts();
        const idx = contacts.findIndex(item => String(item?.id || '').trim() === safeId);
        if (idx < 0) return false;
        contacts.splice(idx, 1);
        this.saveContacts();
        return true;
    }

    getSmsConversations() {
        if (!this._smsConversations) {
            const saved = this.storage.get('phone_call_sms_conversations', null);
            if (saved) {
                try {
                    this._smsConversations = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析短信会话失败:', e);
                    this._smsConversations = [];
                }
            } else {
                this._smsConversations = [];
            }
        }
        return Array.isArray(this._smsConversations) ? this._smsConversations : [];
    }

    saveSmsConversations() {
        this.storage.set('phone_call_sms_conversations', this.getSmsConversations());
    }

    getSmsProcessedBatches() {
        if (!this._smsProcessedBatches) {
            const saved = this.storage.get('phone_call_sms_processed_batches', null);
            if (saved) {
                try {
                    this._smsProcessedBatches = typeof saved === 'string' ? JSON.parse(saved) : saved;
                } catch (e) {
                    console.error('[PhoneCallData] 解析短信批次记录失败:', e);
                    this._smsProcessedBatches = [];
                }
            } else {
                this._smsProcessedBatches = [];
            }
        }
        return Array.isArray(this._smsProcessedBatches) ? this._smsProcessedBatches : [];
    }

    hasProcessedSmsBatch(batchId, parserVersion) {
        const safeBatchId = String(batchId || '').trim();
        const safeVersion = String(parserVersion || '').trim();
        if (!safeBatchId || !safeVersion) return false;
        return this.getSmsProcessedBatches().some(record =>
            record?.batchId === safeBatchId && record?.parserVersion === safeVersion
        );
    }

    markSmsBatchProcessed(batchId, tavernMessageIndex, parserVersion) {
        const safeBatchId = String(batchId || '').trim();
        const safeVersion = String(parserVersion || '').trim();
        if (!safeBatchId || !safeVersion) return;

        const records = this.getSmsProcessedBatches();
        const floor = Number.isInteger(tavernMessageIndex) ? tavernMessageIndex : null;
        const existing = records.find(record => record?.batchId === safeBatchId);
        if (existing) {
            existing.tavernMessageIndex = floor;
            existing.parserVersion = safeVersion;
        } else {
            records.push({ batchId: safeBatchId, tavernMessageIndex: floor, parserVersion: safeVersion });
        }
        if (records.length > 500) records.splice(0, records.length - 500);
        this.storage.set('phone_call_sms_processed_batches', records);
    }

    _removeSmsProcessedBatches(predicate) {
        const records = this.getSmsProcessedBatches();
        const retained = records.filter(record => !predicate(record));
        if (retained.length === records.length) return false;
        this._smsProcessedBatches = retained;
        this.storage.set('phone_call_sms_processed_batches', retained);
        return true;
    }

    getSmsConversationByName(name) {
        const normalizedName = String(name || '').trim().toLocaleLowerCase('zh-CN');
        if (!normalizedName) return null;
        return this.getSmsConversations().find(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        ) || null;
    }

    addSmsMessage(contactName, text, timeInfo = {}, options = {}) {
        const safeName = String(contactName || '').trim();
        const safeText = String(text || '').trim();
        if (!safeName || !safeText) return null;

        const conversations = this.getSmsConversations();
        let conversation = this.getSmsConversationByName(safeName);
        const createdAt = Date.now();
        if (!conversation) {
            conversation = {
                id: `phone_sms_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
                name: safeName,
                messages: [],
                createdAt,
                updatedAt: createdAt
            };
            conversations.push(conversation);
        }
        if (!Array.isArray(conversation.messages)) conversation.messages = [];

        const message = {
            id: `phone_sms_message_${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
            direction: String(options?.direction || 'outgoing'),
            from: String(options?.from || 'me'),
            text: safeText,
            date: String(timeInfo?.date || ''),
            time: String(timeInfo?.time || ''),
            weekday: String(timeInfo?.weekday || ''),
            createdAt,
            batchId: String(options?.batchId || ''),
            fromMainChatTag: options?.fromMainChatTag === true,
            sourceIndex: Number.isInteger(options?.sourceIndex) ? options.sourceIndex : null,
            tavernMessageIndex: Number.isInteger(options?.tavernMessageIndex)
                ? options.tavernMessageIndex
                : null
        };
        conversation.messages.push(message);
        conversation.updatedAt = createdAt;
        this.saveSmsConversations();
        return { conversation, message };
    }

    addIncomingSmsMessage(senderName, text, timeInfo = {}, metadata = {}) {
        const safeSender = String(senderName || '').trim();
        return this.addSmsMessage(safeSender, text, timeInfo, {
            direction: 'incoming',
            from: safeSender,
            batchId: metadata?.batchId,
            fromMainChatTag: metadata?.fromMainChatTag === true,
            sourceIndex: metadata?.sourceIndex,
            tavernMessageIndex: metadata?.tavernMessageIndex
        });
    }

    _removeSmsMessages(predicate) {
        const conversations = this.getSmsConversations();
        let changed = false;

        for (let index = conversations.length - 1; index >= 0; index -= 1) {
            const conversation = conversations[index];
            const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
            const retained = messages.filter(message => !predicate(message));
            if (retained.length === messages.length) continue;

            changed = true;
            if (retained.length === 0) {
                conversations.splice(index, 1);
                continue;
            }

            conversation.messages = retained;
            const latestMessage = retained[retained.length - 1];
            conversation.updatedAt = Number(latestMessage?.createdAt || conversation.updatedAt || Date.now());
        }

        if (changed) this.saveSmsConversations();
        return changed;
    }

    removeMainChatSmsAtFloor(tavernMessageIndex) {
        const floor = Number(tavernMessageIndex);
        if (!Number.isFinite(floor)) return false;
        const messagesChanged = this._removeSmsMessages(message =>
            message?.fromMainChatTag === true
            && Number(message?.tavernMessageIndex) === floor
        );
        const batchesChanged = this._removeSmsProcessedBatches(record =>
            Number(record?.tavernMessageIndex) === floor
        );
        return messagesChanged || batchesChanged;
    }

    rollbackSmsToFloor(tavernMessageIndex) {
        const floor = Number(tavernMessageIndex);
        if (!Number.isFinite(floor)) return false;
        const messagesChanged = this._removeSmsMessages(message =>
            message?.fromMainChatTag === true
            && Number.isFinite(Number(message?.tavernMessageIndex))
            && Number(message.tavernMessageIndex) >= floor
        );
        const batchesChanged = this._removeSmsProcessedBatches(record =>
            Number.isFinite(Number(record?.tavernMessageIndex))
            && Number(record.tavernMessageIndex) >= floor
        );
        return messagesChanged || batchesChanged;
    }

    deleteSmsMessage(contactName, messageId) {
        const safeMessageId = String(messageId || '').trim();
        const normalizedName = String(contactName || '').trim().toLocaleLowerCase('zh-CN');
        if (!safeMessageId || !normalizedName) return null;

        const conversations = this.getSmsConversations();
        const conversationIndex = conversations.findIndex(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        );
        if (conversationIndex < 0) return null;

        const conversation = conversations[conversationIndex];
        if (!Array.isArray(conversation.messages)) return null;
        const messageIndex = conversation.messages.findIndex(message =>
            String(message?.id || '').trim() === safeMessageId
        );
        if (messageIndex < 0) return null;

        const [message] = conversation.messages.splice(messageIndex, 1);
        const conversationRemoved = conversation.messages.length === 0;
        if (conversationRemoved) {
            conversations.splice(conversationIndex, 1);
        } else {
            const latestMessage = conversation.messages[conversation.messages.length - 1];
            conversation.updatedAt = Number(latestMessage?.createdAt || conversation.updatedAt || Date.now());
        }
        this.saveSmsConversations();
        return { message, conversation, conversationRemoved };
    }

    deleteSmsConversation(contactName) {
        const normalizedName = String(contactName || '').trim().toLocaleLowerCase('zh-CN');
        if (!normalizedName) return null;

        const conversations = this.getSmsConversations();
        const conversationIndex = conversations.findIndex(conversation =>
            String(conversation?.name || '').trim().toLocaleLowerCase('zh-CN') === normalizedName
        );
        if (conversationIndex < 0) return null;

        const [conversation] = conversations.splice(conversationIndex, 1);
        this.saveSmsConversations();
        return conversation || null;
    }

    // 清空缓存（切换聊天时调用）
    clearCache() {
        this._callHistory = null;
        this._contacts = null;
        this._smsConversations = null;
        this._smsProcessedBatches = null;
    }
}
