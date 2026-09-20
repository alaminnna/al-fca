import { IdentityKeyStore, SessionStore, PreKeyStore, SignedPreKeyStore, SenderKeyStore, KyberPreKeyStore, PrivateKey, ProtocolAddress, PublicKey, Direction, SessionRecord, PreKeyRecord, SignedPreKeyRecord, SenderKeyRecord, KyberPreKeyRecord, IdentityKeyPair } from '@signalapp/libsignal-client';

type Platform = "facebook" | "messenger";
interface BaseAttachment {
    url?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    /** For E2EE media download - base64-encoded */
    mediaKey?: string;
    mediaSha256?: string;
    mediaEncSha256?: string;
    directPath?: string;
}
interface ImageAttachment extends BaseAttachment {
    type: "image" | "gif" | "photo";
    width?: number;
    height?: number;
    previewUrl?: string;
}
interface VideoAttachment extends BaseAttachment {
    type: "video";
    width?: number;
    height?: number;
    duration?: number;
    previewUrl?: string;
}
interface AudioAttachment extends BaseAttachment {
    type: "audio" | "voice";
    duration?: number;
}
interface FileAttachment extends BaseAttachment {
    type: "file";
}
interface StickerAttachment extends BaseAttachment {
    type: "sticker";
    stickerID: number;
}
interface LocationAttachment extends BaseAttachment {
    type: "location";
    latitude: number;
    longitude: number;
}
interface LinkAttachment extends BaseAttachment {
    type: "link";
    description?: string;
    sourceText?: string;
    previewUrl?: string;
}
type Attachment = ImageAttachment | VideoAttachment | AudioAttachment | FileAttachment | StickerAttachment | LocationAttachment | LinkAttachment;
interface Mention {
    userId: string;
    /** UTF-16 code unit offset in the message text */
    offset: number;
    /** UTF-16 code unit length */
    length: number;
    /** "user" | "thread" | "group" */
    type?: string;
}
interface ReplyTo {
    messageId: string;
    senderId?: string;
    text?: string;
}
interface MessengerMessage {
    id: string;
    threadId: string;
    senderId: string;
    text: string;
    timestampMs: number;
    replyTo?: ReplyTo;
    attachments?: Attachment[];
    mentions?: Mention[];
    isAdminMsg?: boolean;
}
type E2EEMessageKind = "text" | "image" | "video" | "audio" | "document" | "sticker" | "reaction" | "edit" | "revoke" | "unknown";
interface BaseE2EEMessage {
    id: string;
    /** Stable conversation ID. For DMs this is the bare Facebook user ID; for groups it is the group JID. */
    threadId: string;
    /** Canonical E2EE chat JID. For DMs this uses the bare .0 Messenger device; senderJid keeps the actual sender device. */
    chatJid: string;
    /** Device-specific sender JID, e.g. user.device@msgr. */
    senderJid: string;
    /** Bare Facebook sender/user ID. */
    senderId: string;
    senderDeviceId?: number;
    isGroup: boolean;
    kind: E2EEMessageKind;
    /** Text body when present; empty string for non-text E2EE events. */
    text: string;
    timestampMs: number;
    attachments?: Attachment[];
    replyTo?: ReplyTo;
    mentions?: Mention[];
}
interface E2EETextMessage extends BaseE2EEMessage {
    kind: "text";
    text: string;
}
interface E2EEMediaMessage extends BaseE2EEMessage {
    kind: "image" | "video" | "audio" | "document" | "sticker";
    media?: unknown;
}
interface E2EEReactionMessage extends BaseE2EEMessage {
    kind: "reaction";
    reaction: string;
    targetId?: string;
}
interface E2EEEditMessage extends BaseE2EEMessage {
    kind: "edit";
    targetId?: string;
}
interface E2EERevokeMessage extends BaseE2EEMessage {
    kind: "revoke";
    targetId?: string;
    fromMe?: boolean;
}
interface E2EEUnknownMessage extends BaseE2EEMessage {
    kind: "unknown";
    raw?: unknown;
}
type E2EEMessage = E2EETextMessage | E2EEMediaMessage | E2EEReactionMessage | E2EEEditMessage | E2EERevokeMessage | E2EEUnknownMessage;
type MessengerEvent = {
    type: "message";
    data: MessengerMessage;
} | {
    type: "messageEdit";
    data: {
        messageId: string;
        threadId: string;
        newText: string;
        editCount: number;
        timestampMs: number;
    };
} | {
    type: "reaction";
    data: {
        messageId: string;
        threadId: string;
        actorId: string;
        /** Empty string = reaction removed */
        reaction: string;
        timestampMs: number;
    };
} | {
    type: "typing";
    data: {
        threadId: string;
        senderId: string;
        isTyping: boolean;
    };
} | {
    type: "message_unsend";
    data: {
        messageId: string;
        threadId: string;
        actorId: string;
        timestampMs: number;
    };
} | {
    type: "read_receipt";
    data: {
        threadId: string;
        readerId: string;
        readWatermarkTimestampMs?: number;
        timestampMs: number;
    };
} | {
    type: "presence";
    data: {
        userId: string;
        isOnline: boolean;
        lastActiveTimestampMs?: number;
    };
} | {
    type: "e2ee_connected";
    data: Record<string, never>;
} | {
    type: "e2ee_message";
    data: E2EEMessage;
} | {
    type: "e2ee_reaction";
    data: {
        messageId: string;
        chatJid: string;
        senderJid: string;
        senderId: string;
        /** Empty string = unreaction */
        reaction: string;
    };
} | {
    type: "e2ee_receipt";
    data: {
        type: string;
        chat: string;
        sender: string;
        messageIds: string[];
    };
} | {
    type: "disconnected";
    data: {
        isE2EE?: boolean;
    };
} | {
    type: "reconnected";
    data: Record<string, never>;
} | {
    type: "ready";
    data: {
        isNewSession: boolean;
    };
} | {
    type: "raw";
    data: Record<string, unknown>;
} | {
    type: "error";
    data: {
        message: string;
        code?: number;
    };
};

interface SendMessageInput {
    threadId: string;
    text: string;
    replyToMessageId?: string;
    /**
     * JID of the original message sender for E2EE reply (QuotedMessage.participant field).
     * - For DM: the bare JID of the peer (e.g. "123456789.0@msgr"); if omitted, defaults to the peer's JID.
     * - For group: the full member JID who sent the original message (e.g. "123456789.160@msgr"); required
     *   for the server to correctly thread the reply in the group conversation.
     */
    replyToSenderJid?: string;
}
interface SendMediaInput {
    threadId: string;
    data: Buffer;
    fileName: string;
    /** Optional; inferred from fileName extension when omitted. */
    mimeType?: string;
    caption?: string;
    replyToMessageId?: string;
    /**
     * JID of the original message sender for E2EE reply (QuotedMessage.participant field).
     * See SendMessageInput.replyToSenderJid for details.
     */
    replyToSenderJid?: string;
    /** Optional media width in pixels for E2EE image/video/sticker payloads. */
    width?: number;
    /** Optional media height in pixels for E2EE image/video/sticker payloads. */
    height?: number;
    /** Optional media duration in whole seconds for E2EE video/audio payloads. */
    seconds?: number;
    /** Alias for seconds, kept for callers that use media-style naming. */
    duration?: number;
    /** Whether E2EE audio should be sent as push-to-talk/voice. Defaults to true for sendAudio. */
    ptt?: boolean;
}
/** A single attachment item inside a multi-attachment message. */
interface SendAttachmentItem {
    data: Buffer;
    fileName: string;
    /** Optional MIME type; inferred from fileName extension when omitted. */
    mimeType?: string;
    /** Optional width/height for image or video payloads. */
    width?: number;
    height?: number;
    /** Optional duration in seconds for video/audio payloads. */
    seconds?: number;
    /** Whether audio should be sent as push-to-talk/voice. */
    ptt?: boolean;
}
/**
 * Send multiple attachments in a single Messenger message.
 *
 * - **Non-E2EE threads**: All attachments are bundled into one FCA message,
 *   delivered as a multi-attachment post.
 * - **E2EE threads**: Each attachment is sent as a separate encrypted E2EE
 *   media message (the protocol does not support multi-attachment in one
 *   encrypted frame), so `results` will contain one entry per attachment.
 */
interface SendMultipleMediaInput {
    threadId: string;
    /** Array of file attachments to send. At least one entry is required. */
    attachments: SendAttachmentItem[];
    /** Optional caption applied to the first attachment (or to the bundled non-E2EE message). */
    caption?: string;
    replyToMessageId?: string;
}
interface TypingInput {
    threadId: string;
    isTyping: boolean;
}
interface SendReactionInput {
    messageId: string;
    reaction: string;
    /** Thread ID or canonical E2EE chat JID containing the target message. */
    threadId: string;
    /** Sender JID of the target E2EE message; required for reacting to someone else's group message. */
    senderJid?: string;
    /** Alias for senderJid for callers that prefer explicit target naming. */
    targetSenderJid?: string;
}
interface UnsendMessageInput {
    /** The message ID to revoke/unsend. */
    messageId: string;
    /**
     * The thread ID (or E2EE chat JID) that contains the message.
     * Required to route the revoke through the correct channel:
     * - E2EE threads → encrypted revoke via Noise socket.
     * - Non-E2EE threads → HTTP unsend via fca-unofficial.
     */
    threadId: string;
    /**
     * Whether the message was sent by the current user.
     * Defaults to true. Set to false for admin revoke of others' messages.
     */
    fromMe?: boolean;
}
interface E2EEEditMessageInput {
    /** The thread ID (or E2EE chat JID) containing the message. */
    threadId: string;
    /** The ID of the message to edit. */
    messageId: string;
    /** The new text content. */
    newText: string;
}

interface ClientOptions {
    appStatePath?: string;
    appState?: any[] | string;
    sessionStorePath?: string;
    platform?: Platform;
}
interface SessionData {
    userId: string;
    appState: Array<{
        key: string;
        value: string;
    }>;
    platform: Platform;
    updatedAt: number;
}
type MessengerEventMap = {
    [E in MessengerEvent as E["type"]]: E["data"];
} & {
    event: MessengerEvent;
};

/**
 * E2EE-only Messenger client facade.
 *
 * `fca-unofficial` is still used internally for app-state login and CAT/bootstrap
 * material that the E2EE transport currently requires, but plaintext/non-E2EE
 * messaging, thread management, polls, stickers, and history APIs are intentionally
 * not exposed here. Use `fca-unofficial` directly for those non-E2EE surfaces.
 */
declare class FBClient {
    private readonly options;
    private readonly eventBus;
    private readonly controller;
    constructor(options: ClientOptions);
    /** Listen for events. Supports catch-all or specific event types. */
    onEvent(listener: (event: MessengerEvent) => void): void;
    onEvent<K extends keyof MessengerEventMap>(event: K, listener: (data: MessengerEventMap[K]) => void): void;
    /** Stop listening for events. */
    offEvent(listener: (event: MessengerEvent) => void): void;
    offEvent<K extends keyof MessengerEventMap>(event: K, listener: (data: MessengerEventMap[K]) => void): void;
    /** Legacy helper for the catch-all wrapper event. */
    onAnyEvent(listener: (event: MessengerEvent) => void): void;
    /**
     * Login with appState and prepare auth/CAT bootstrap state.
     * This does not start plaintext/non-E2EE MQTT listening.
     */
    connect(): Promise<{
        userId: string;
    }>;
    disconnect(): Promise<void>;
    connectE2EE(deviceStorePath: string, userId: string): Promise<void>;
    sendNoiseKeepAlive(): Promise<void>;
    sendMessage(input: SendMessageInput): Promise<Record<string, unknown>>;
    sendReaction(input: SendReactionInput): Promise<void>;
    unsendMessage(input: UnsendMessageInput): Promise<void>;
    editMessage(input: E2EEEditMessageInput): Promise<void>;
    sendTyping(input: TypingInput): Promise<void>;
    sendImage(input: SendMediaInput): Promise<Record<string, unknown>>;
    sendVideo(input: SendMediaInput): Promise<Record<string, unknown>>;
    sendAudio(input: SendMediaInput): Promise<Record<string, unknown>>;
    sendFile(input: SendMediaInput): Promise<Record<string, unknown>>;
    /**
     * Send multiple files/attachments in one call.
     *
     * - **Non-E2EE threads**: All attachments land in a single Messenger message.
     * - **E2EE threads**: Each attachment is sent as a separate encrypted message
     *   (E2EE does not support multi-attachment in one frame). Returns an array
     *   with one result per attachment.
     */
    sendFiles(input: SendMultipleMediaInput): Promise<Record<string, unknown> | Record<string, unknown>[]>;
}

interface EncryptMediaResult {
    dataToUpload: Buffer;
    fileSHA256: Buffer;
    fileEncSHA256: Buffer;
    fileLength: number;
    mediaKey: Buffer;
}
interface MediaUploadConfig {
    /** From server's media connection response */
    auth: string;
    /** Host to upload to - Messenger prefers the last host (rupload.facebook.com) */
    host: string;
    /** All hosts from the media_conn response, server order; tried as fallback */
    hosts?: string[];
    ttl?: number;
    authTtl?: number;
    fetchedAtMs?: number;
}
interface MediaUploadResult {
    url: string;
    directPath: string;
    handle: string;
    objectId: string;
}
type MmsTypeStr = "image" | "video" | "ptt" | "document" | "sticker";

/**
 * E2EE Media Crypto - Layer 4
 *
 * Implements the AES-256-CBC + HMAC-SHA256 + HKDF media scheme.
 *
 * No Signal Protocol needed here - this is pure symmetric crypto.
 */

declare const MediaType: {
    readonly image: "WhatsApp Image Keys";
    readonly video: "WhatsApp Video Keys";
    readonly audio: "WhatsApp Audio Keys";
    readonly document: "WhatsApp Document Keys";
    readonly sticker: "WhatsApp Image Keys";
    readonly history: "WhatsApp History Keys";
    readonly appstate: "WhatsApp App State Keys";
};
type MediaTypeKey = keyof typeof MediaType;

interface DeviceJSON {
    /** schema version for local migrations; absent in old stores */
    schema_version?: number;
    /** base64, 32 bytes - Noise handshake key */
    noise_key_priv: string;
    /** base64, 32 bytes - Signal identity key */
    identity_key_priv: string;
    /** base64, 32 bytes - Signal signed prekey */
    signed_pre_key_priv: string;
    signed_pre_key_id: number;
    /** base64, 64 bytes - Ed25519 sig of signed prekey by identity key */
    signed_pre_key_sig: string;
    registration_id: number;
    /** base64, 32 bytes */
    adv_secret_key: string;
    /** uuid v4 */
    facebook_uuid: string;
    jid_user?: string;
    jid_device?: number;
    /** address -> base64(32B identity pub key) */
    identities?: Record<string, string>;
    /** address -> base64(serialized SessionRecord) */
    sessions?: Record<string, string>;
    /** id(number) -> base64(32B priv key) */
    pre_keys?: Record<string, string>;
    /** "groupJID:senderAddress" -> base64(serialized SenderKeyRecord) */
    sender_keys?: Record<string, string>;
    /** id(number) -> base64(serialized SignedPreKeyRecord) */
    signed_pre_keys?: Record<string, string>;
    /** next prekey ID to generate */
    next_pre_key_id: number;
}
interface RawPreKeyBundle {
    registrationId: number;
    deviceId: number;
    identityKey: Uint8Array;
    signedPreKey: {
        keyId: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
    };
    /** Optional: one-time prekey (may be absent if server ran out) */
    preKey?: {
        keyId: number;
        publicKey: Uint8Array;
    };
    /**
     * Optional: Kyber (PQ) prekey.
     */
    kyberPreKey?: {
        keyId: number;
        publicKey: Uint8Array;
        signature: Uint8Array;
    };
}
interface E2EESendTextOptions {
    /** Recipient JID (DM) or group JID */
    toJid: string;
    text: string;
    isGroup: boolean;
    /** Own JID - required for all sends (self address in Signal protocol) */
    selfJid: string;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EESendTextResult {
    /** Encrypted MessageTransport bytes - feed into Signal cipher */
    plaintext: Buffer;
    /** frankingTag for the message node */
    frankingTag: Buffer;
}
interface E2EEEncryptMediaOptions {
    type: MediaTypeKey;
    data: Buffer;
    mmsType: MmsTypeStr;
}
interface E2EEEncryptMediaResult {
    mediaKey: Buffer;
    fileSHA256: Buffer;
    fileEncSHA256: Buffer;
    fileLength: number;
    directPath: string;
    /** Upload handle returned by the media CDN. Useful for parity with native clients. */
    handle: string;
    /** CDN object ID returned by upload; encoded into WAMediaTransport ancillary data. */
    objectId: string;
    /** Pre-built MediaFields for encodeImageMessage / encodeVideoMessage / etc. */
    mediaFields: Omit<MediaFields, "caption" | "ptt" | "fileName">;
}
interface E2EEDecryptMediaOptions {
    data: Buffer;
    mediaKey: Buffer;
    type: MediaTypeKey;
    fileSHA256?: Buffer;
    fileEncSHA256?: Buffer;
}
type EncryptionResult = {
    type: "dm";
    encrypted: {
        type: "msg" | "pkmsg";
        ciphertext: Buffer;
    };
    frankingTag: Buffer;
    messageApp: Buffer;
} | {
    type: "group";
    messageApp: Buffer;
    groupCiphertext: Buffer;
    devicePayload: Buffer;
    selfDevicePayload: Buffer;
    skdmPayload: Buffer;
    skdm: {
        groupId: string;
        skdmBytes: Buffer;
        distributionId: string;
    };
    frankingTag: Buffer;
};
interface MediaFields {
    caption?: string;
    mimeType: string;
    fileSHA256: Buffer;
    fileLength: number;
    mediaKey: Buffer;
    fileEncSHA256: Buffer;
    directPath: string;
    /** Optional CDN object ID from media upload response. */
    objectId?: string;
    /** Unix timestamp seconds for the media key. Defaults to current time when encoding. */
    mediaKeyTimestamp?: number;
    width?: number;
    height?: number;
    seconds?: number;
    ptt?: boolean;
    fileName?: string;
}
interface MessageTransportOptions {
    /** Application payload. Omit for SKDM-only device fanout. */
    messageApp?: Buffer;
    /** Included only when sending a copy to own other devices */
    dsm?: {
        destinationJid: string;
        phash: string;
    };
    /** Included only for group messages */
    skdm?: {
        groupId: string;
        skdmBytes: Buffer;
    };
    /** Included for group sends with backup directive metadata. */
    backupDirective?: {
        messageId: string;
        actionType?: "UPSERT" | "REMOVE";
    };
    padding?: Buffer;
}
interface E2EEUploadResult {
    messageId: string;
    timestampMs: number;
}
interface E2EEDownloadResult {
    data: Buffer;
    mimeType: string;
    fileSize: number;
}
interface E2EESendImageOptions {
    chatJid: string;
    data: Buffer;
    mimeType?: string;
    caption?: string;
    width?: number;
    height?: number;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EESendVideoOptions {
    chatJid: string;
    data: Buffer;
    mimeType?: string;
    caption?: string;
    width?: number;
    height?: number;
    duration?: number;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EESendAudioOptions {
    chatJid: string;
    data: Buffer;
    mimeType?: string;
    duration?: number;
    ptt?: boolean;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EESendDocumentOptions {
    chatJid: string;
    data: Buffer;
    fileName: string;
    mimeType?: string;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EESendStickerOptions {
    chatJid: string;
    data: Buffer;
    mimeType?: string;
    width?: number;
    height?: number;
    replyToId?: string;
    replyToSenderJid?: string;
}
interface E2EEDownloadOptions {
    directPath: string;
    /** Base64-encoded */
    mediaKey: string;
    /** Base64-encoded */
    mediaSha256: string;
    /** Base64-encoded */
    mediaEncSha256?: string;
    /** "image" | "video" | "audio" | "voice" | "document" | "sticker" */
    mediaType: string;
    mimeType?: string;
    fileSize?: number;
}

/**
 * E2EE DeviceStore - Layer 5
 *
 * Persists all Signal Protocol key material to a JSON file.
 * JSON schema is compatible with bridge-go DeviceJSON so existing device
 * files can be imported without re-registration.
 *
 * Implements the @signalapp/libsignal-client store interfaces:
 *   IdentityKeyStore, SessionStore, PreKeyStore, SignedPreKeyStore, SenderKeyStore
 */

declare class DeviceStore implements IdentityKeyStore, SessionStore, PreKeyStore, SignedPreKeyStore, SenderKeyStore, KyberPreKeyStore {
    private identities;
    private sessions;
    private preKeys;
    private signedPreKeys;
    private senderKeys;
    private kyberKeys;
    noiseKeyPriv: Buffer;
    private identityKeyPriv;
    signedPreKeyPriv: Buffer;
    signedPreKeyId: number;
    signedPreKeySig: Buffer;
    registrationId: number;
    advSecretKey: Buffer;
    facebookUUID: string;
    jidUser?: string;
    jidDevice?: number;
    nextPreKeyId: number;
    autoTrust: boolean;
    private readonly path;
    private onDataChanged?;
    private constructor();
    /** Create or load from a JSON file path. */
    /** Persist the Messenger JID assigned to this registered E2EE device. */
    setJIDs(id1: string, id2: string): void;
    static fromFile(path: string): Promise<DeviceStore>;
    /** Load from a JSON string (no file I/O). */
    static fromData(json: string, onDataChanged?: (json: string) => void): Promise<DeviceStore>;
    /** Create a fresh in-memory device (nothing persisted). */
    static memoryOnly(): Promise<DeviceStore>;
    private initNew;
    private loadJSON;
    toJSON(): DeviceJSON;
    getData(): string;
    saveToFile(): void;
    getIdentityPublicKey(): Buffer;
    getIdentityPrivateKey(): Buffer;
    getSignedPreKeyPublicKey(): Buffer;
    getIdentityKey(): Promise<PrivateKey>;
    _getIdentityKey(): Promise<any>;
    getLocalRegistrationId(): Promise<number>;
    _getLocalRegistrationId(): Promise<number>;
    _saveIdentity(name: any, key: any): Promise<boolean>;
    saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<boolean>;
    isTrustedIdentity(name: ProtocolAddress, key: PublicKey, _direction: Direction): Promise<boolean>;
    _isTrustedIdentity(name: any, key: any, sending: boolean): Promise<boolean>;
    getIdentity(name: ProtocolAddress): Promise<PublicKey | null>;
    _getIdentity(name: any): Promise<any>;
    saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void>;
    _saveSession(name: any, record: any): Promise<void>;
    getSession(name: ProtocolAddress): Promise<SessionRecord | null>;
    _getSession(name: any): Promise<any>;
    getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]>;
    savePreKey(id: number, record: PreKeyRecord): Promise<void>;
    _savePreKey(id: number, record: any): Promise<void>;
    getPreKey(id: number): Promise<PreKeyRecord>;
    _getPreKey(id: number): Promise<any>;
    removePreKey(id: number): Promise<void>;
    _removePreKey(id: number): Promise<void>;
    saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void>;
    _saveSignedPreKey(id: number, record: any): Promise<void>;
    getSignedPreKey(id: number): Promise<SignedPreKeyRecord>;
    _getSignedPreKey(id: number): Promise<any>;
    saveSenderKey(senderAddress: ProtocolAddress, distributionId: string, record: SenderKeyRecord): Promise<void>;
    _saveSenderKey(sender: any, distributionId: any, record: any): Promise<void>;
    getSenderKey(senderAddress: ProtocolAddress, distributionId: string): Promise<SenderKeyRecord>;
    listSenderKeyDistributionIds(senderAddress: ProtocolAddress): string[];
    _getSenderKey(sender: any, distributionId: any): Promise<any>;
    saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void>;
    _saveKyberPreKey(id: number, record: any): Promise<void>;
    getKyberPreKey(id: number): Promise<KyberPreKeyRecord>;
    _getKyberPreKey(id: number): Promise<any>;
    markKyberPreKeyUsed(id: number): Promise<void>;
    _markKyberPreKeyUsed(id: number): Promise<void>;
    getIdentityKeyPair(): Promise<IdentityKeyPair>;
    /** Get a fresh unused prekey ID and bump the counter */
    allocPreKeyId(): number;
    /** True if store has an established session for this address */
    hasSession(address: string): boolean;
    getPreKeyCount(): number;
}

/**
 * Reply-to (quoted message) metadata for MessageApplication.Metadata.QuotedMessage.
 *
 * Proto schema (WAMsgApplication.proto):
 *   message QuotedMessage {
 *     optional string stanzaID   = 1;  // message ID of the quoted message
 *     optional string remoteJID  = 2;  // chat JID (thread) that contains the quoted message
 *     optional string participant = 3; // sender JID of the quoted message (required for groups)
 *   }
 */
interface ReplyToMeta {
    /** Message ID (stanzaID) of the quoted message. */
    messageId: string;
    /** Chat JID (remoteJID) — the thread where the quoted message lives. */
    chatJid: string;
    /**
     * Sender JID (participant) of the quoted message.
     * - For DM: same as chatJid (the peer's bare JID).
     * - For group: the specific member JID who sent the original message.
     */
    senderJid: string;
}
/**
 * Wrap a ConsumerApplication payload into a MessageApplication.
 * Returns (messageApp bytes, frankingKey, frankingTag).
 */
declare function encodeMessageApplication(consumerAppBytes: Buffer, replyTo?: ReplyToMeta): {
    messageApp: Buffer;
    frankingKey: Buffer;
    frankingTag: Buffer;
};

/**
 * Encode a ConsumerApplication text message.
 * Field 1 = Payload { field 1 = Content { field 1 = MessageText { field 1 = text } } }
 */
declare function encodeTextMessage(text: string): Buffer;
/** Encode a ConsumerApplication image message. */
declare function encodeImageMessage(m: MediaFields): Buffer;
/** Encode a ConsumerApplication video message. */
declare function encodeVideoMessage(m: MediaFields): Buffer;
/** Encode a ConsumerApplication audio/voice message. */
declare function encodeAudioMessage(m: MediaFields): Buffer;
/** Encode a ConsumerApplication document message. */
declare function encodeDocumentMessage(m: MediaFields): Buffer;
/** Encode a ConsumerApplication sticker message. */
declare function encodeStickerMessage(m: MediaFields): Buffer;
interface MessageKeyOptions {
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
}
interface ReactionMessageKeyOptions extends MessageKeyOptions {
    senderTimestampMs?: number;
}
/** Encode a reaction message. */
declare function encodeReactionMessage(targetMessageId: string, emoji: string, keyOpts?: ReactionMessageKeyOptions): Buffer;
/** Encode a message edit. */
declare function encodeEditMessage(targetMessageId: string, newText: string): Buffer;
/** Encode a revoke (unsend) message. */
declare function encodeRevokeMessage(messageId: string, keyOptsOrFromMe?: MessageKeyOptions | boolean): Buffer;

/**
 * Encode the MessageTransport protobuf that will be fed into Signal cipher.
 */
declare function encodeMessageTransport(opts: MessageTransportOptions): Buffer;

interface DMTextFanoutPayloads {
    type: "dm";
    messageApp: Buffer;
    devicePayload: Buffer;
    selfDevicePayload: Buffer;
    frankingTag: Buffer;
}
declare class E2EEClient {
    private store;
    constructor(store: DeviceStore);
    /** Establish a session with a contact using their prekey bundle (X3DH). */
    establishSession(recipientJid: string, bundle: RawPreKeyBundle): Promise<void>;
    processSenderKeyDistribution(senderJid: string, skdmBytes: Buffer, groupJid?: string): Promise<void>;
    /** Build DM text transports for V3 participant fanout. */
    buildDMTextFanoutPayloads(opts: E2EESendTextOptions): Promise<DMTextFanoutPayloads>;
    /**
     * Build and encrypt a DM text message for Signal transport.
     * Kept for low-level callers; production send should fan out through participants.
     */
    encryptDMText(opts: E2EESendTextOptions): Promise<Extract<EncryptionResult, {
        type: "dm";
    }>>;
    /** Build and encrypt a group text message. */
    encryptGroupText(groupJid: string, selfJid: string, text: string, messageId: string, replyToId?: string, replyToSenderJid?: string): Promise<Extract<EncryptionResult, {
        type: "group";
    }>>;
    /** Build and encrypt a pre-built MessageApplication for a group send. */
    encryptGroupMessageApplication(groupJid: string, selfJid: string, messageApp: Buffer, messageId: string): Promise<Omit<Extract<EncryptionResult, {
        type: "group";
    }>, "frankingTag">>;
    /** Create a sender-key distribution payload for targeted group retry responses. */
    createSenderKeyDistributionPayload(groupJid: string, selfJid: string): Promise<{
        groupId: string;
        skdmBytes: Buffer;
        distributionId: string;
    }>;
    /** Encrypt a MessageApplication payload directly to one device (used for retry responses). */
    encryptMessageAppForDevice(recipientJid: string, selfJid: string, messageApp: Buffer, opts?: {
        skdm?: {
            groupId: string;
            skdmBytes: Buffer;
        };
        dsm?: {
            destinationJid: string;
            phash: string;
        };
        backupDirective?: {
            messageId: string;
            actionType: "UPSERT" | "REMOVE";
        };
    }): Promise<{
        type: "msg" | "pkmsg";
        ciphertext: Buffer;
    }>;
    /** Check if a session exists for a given device JID. */
    hasSession(jid: string): Promise<boolean>;
    /** Encrypt an SKDM for a specific device DM. */
    encryptSKDM(recipientJid: string, selfJid: string, skdm: {
        groupId: string;
        skdmBytes: Buffer;
    }): Promise<{
        type: "msg" | "pkmsg";
        ciphertext: Buffer;
    }>;
    encryptDevicePayload(recipientJid: string, selfJid: string, payload: Buffer): Promise<{
        type: "msg" | "pkmsg";
        ciphertext: Buffer;
    }>;
    /** Decrypt a DM Signal message (type = "msg"). Returns raw MessageTransport bytes. */
    decryptDMMessage(senderJid: string, ciphertext: Buffer): Promise<Buffer>;
    /** Decrypt a DM PreKeySignalMessage (first message from sender). */
    decryptDMPreKeyMessage(senderJid: string, selfJid: string, ciphertext: Buffer): Promise<Buffer>;
    decryptGroupMessage(senderJid: string, ciphertext: Buffer, groupJid?: string): Promise<Buffer>;
    /** Encrypt media bytes for upload. Returns crypto fields + uploadable buffer. */
    encryptMedia(data: Buffer, type: MediaTypeKey): EncryptMediaResult;
    /** Decrypt downloaded E2EE media. */
    decryptMedia(opts: E2EEDecryptMediaOptions): Buffer;
    /**
     * Encrypt + upload media in one step.
     * Returns all fields needed to build a ConsumerApplication media message.
     * @param refreshConfig Optional callback to refresh upload config on 401.
     */
    encryptAndUploadMedia(uploadConfig: MediaUploadConfig, data: Buffer, type: MediaTypeKey, mimeType: string, refreshConfig?: () => Promise<MediaUploadConfig>): Promise<E2EEEncryptMediaResult>;
    buildTextMessage: typeof encodeTextMessage;
    buildImageMessage: typeof encodeImageMessage;
    buildVideoMessage: typeof encodeVideoMessage;
    buildAudioMessage: typeof encodeAudioMessage;
    buildDocumentMessage: typeof encodeDocumentMessage;
    buildStickerMessage: typeof encodeStickerMessage;
    buildReactionMessage: typeof encodeReactionMessage;
    buildEditMessage: typeof encodeEditMessage;
    buildRevokeMessage: typeof encodeRevokeMessage;
    buildMessageApplication: typeof encodeMessageApplication;
    buildMessageTransport: typeof encodeMessageTransport;
}

/**
 * E2EEService - extension point for end-to-end encrypted media operations.
 *
 * The JS/TS side of this bridge keeps E2EE media upload/download separate
 * from the non-E2EE Messenger gateway. fca-unofficial speaks to the
 * standard Messenger LightSpeed API (non-E2EE) only.
 *
 * This service therefore acts as a typed facade that:
 *  1. Documents the contract (what operations are expected, their inputs/outputs).
 *  2. Provides an extension point where a future native-addon or WASM layer
 *     can be plugged in.
 *  3. Exposes a guard so callers know E2EE is not yet connected.
 *
 * Concrete implementations can extend or replace this class.
 */

declare class E2EEService {
    private _connected;
    private e2eeClient?;
    private uploadConfig?;
    setProvider(client: E2EEClient, uploadConfig: MediaUploadConfig): void;
    get isConnected(): boolean;
    /** Called by an external E2EE provider when it establishes a connection. */
    markConnected(): void;
    /** Called when the E2EE connection drops. */
    markDisconnected(): void;
    ensureEnabled(): void;
    getClient(): E2EEClient;
    /** Send an E2EE image. Requires a concrete provider implementation. */
    sendImage(opts: E2EESendImageOptions): Promise<E2EEUploadResult>;
    /** Send an E2EE video. */
    sendVideo(opts: E2EESendVideoOptions): Promise<E2EEUploadResult>;
    /** Send an E2EE audio/voice message. */
    sendAudio(opts: E2EESendAudioOptions): Promise<E2EEUploadResult>;
    /** Send an E2EE document/file. */
    sendDocument(opts: E2EESendDocumentOptions): Promise<E2EEUploadResult>;
    /** Send an E2EE sticker. */
    sendSticker(opts: E2EESendStickerOptions): Promise<E2EEUploadResult>;
    /** Download E2EE media by decrypting it with the provided keys. */
    downloadMedia(opts: E2EEDownloadOptions): Promise<E2EEDownloadResult>;
}

interface AppEnv {
    appStatePath?: string;
    appState?: any[] | string;
    sessionStorePath?: string;
    platform: Platform;
}
interface AuthConfig {
    appStatePath?: string;
    appState?: any[] | string;
    platform: Platform;
}

export { type AppEnv, type Attachment, type AuthConfig, type ClientOptions, type E2EEDecryptMediaOptions, type E2EEDownloadOptions, type E2EEDownloadResult, type E2EEEditMessageInput, type E2EEEncryptMediaOptions, type E2EEEncryptMediaResult, type E2EEMessage, type E2EEMessageKind, type E2EESendTextOptions, type E2EESendTextResult, E2EEService, FBClient, type MediaUploadConfig, type MediaUploadResult, type Mention, type MessengerEvent, type MessengerEventMap, type MmsTypeStr, type Platform, type ReplyTo, type SendAttachmentItem, type SendMediaInput, type SendMessageInput, type SendMultipleMediaInput, type SendReactionInput, type SessionData, type TypingInput, type UnsendMessageInput };
