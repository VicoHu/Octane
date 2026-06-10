import { getByKey, putRecord, deleteRecord } from '@/shared/db/database';
import { encrypt, decrypt } from '@/services/CryptoService';
import { updateBookmark } from '@/services/BookmarkService';
import type { Note } from '@/shared/types';

/** 获取笔记（明文） */
export async function getNote(bookmarkId: string): Promise<Note | null> {
  const note = await getByKey<Note>('notes', bookmarkId);
  if (!note) return null;

  if (note.isEncrypted && note.encryptedData && note.iv) {
    const plaintext = await decrypt(note.encryptedData, note.iv);
    return { ...note, content: plaintext };
  }
  return note;
}

/** 保存笔记（自动处理加密/解密） */
export async function saveNote(
  bookmarkId: string,
  content: string,
  sensitive: boolean,
): Promise<void> {
  const existing = await getByKey<Note>('notes', bookmarkId);
  const now = Date.now();

  if (!content.trim()) {
    // 内容为空，删除笔记
    if (existing) {
      await deleteRecord('notes', bookmarkId);
      await updateBookmark(bookmarkId, { hasNote: false, isNoteEncrypted: false });
    }
    return;
  }

  let note: Note;
  if (sensitive) {
    const { encryptedData, iv } = await encrypt(content);
    note = {
      bookmarkId,
      content: '', // 运行时明文不持久化
      isEncrypted: true,
      encryptedData,
      iv,
      updatedAt: now,
    };
  } else {
    note = {
      bookmarkId,
      content,
      isEncrypted: false,
      updatedAt: now,
    };
  }

  await putRecord('notes', note);
  await updateBookmark(bookmarkId, { hasNote: true, isNoteEncrypted: sensitive });
}
