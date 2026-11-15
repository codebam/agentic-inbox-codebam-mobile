/**
 * Picking files to attach to an outbound email. The document picker runs
 * on iOS, Android and web; bytes are read as base64 (the picker returns
 * them directly on web, expo-file-system's File reads them on native).
 * The server accepts up to 5 files and 5 MB of decoded bytes in total;
 * the same bounds are enforced here so a refusal never needs a round trip.
 */

import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Platform } from "react-native";

import type { OutboundAttachment } from "./api";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface PickedAttachment extends OutboundAttachment {
  size: number;
}

/** Decoded byte length of a base64 string (padding-aware). */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function totalAttachmentBytes(attachments: Pick<PickedAttachment, "size">[]): number {
  return attachments.reduce((sum, attachment) => sum + attachment.size, 0);
}

/**
 * Open the system picker and return the chosen files, or null when the
 * user cancelled. Throws a readable Error when a bound would be exceeded.
 */
export async function pickAttachments(existing: PickedAttachment[]): Promise<PickedAttachment[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    base64: Platform.OS === "web",
  });
  if (result.canceled) return null;

  const picked: PickedAttachment[] = [];
  for (const asset of result.assets) {
    let base64 = asset.base64 ?? null;
    if (!base64) {
      base64 = await new File(asset.uri).base64();
    }
    const size = asset.size ?? base64ByteLength(base64);
    picked.push({
      filename: asset.name,
      mimetype: asset.mimeType ?? "application/octet-stream",
      content_base64: base64,
      size,
    });
  }

  const combined = [...existing, ...picked];
  if (combined.length > MAX_ATTACHMENTS) {
    throw new Error(`At most ${MAX_ATTACHMENTS} attachments per email.`);
  }
  if (totalAttachmentBytes(combined) > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachments exceed 5 MB in total.");
  }
  return combined;
}