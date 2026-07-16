import { useCallback, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as VideoThumbnails from 'expo-video-thumbnails';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { supabase } from './supabase';
import type { MediaType } from './types';

export const MAX_MEDIA_DURATION_MS = 60_000;

const MAX_VIDEO_DURATION_SECONDS = MAX_MEDIA_DURATION_MS / 1000;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_COMPRESS_QUALITY = 0.8;
const STORAGE_BUCKET = 'media';

export interface PickedMedia {
  uri: string;
  type: MediaType;
  /** Local URI of a generated thumbnail, video only. */
  thumbnailUri?: string;
}

/**
 * Picks a photo from the library and compresses/resizes it before returning.
 * Returns null if the user cancels. Throws if permission is denied.
 */
export async function pickImage(): Promise<PickedMedia | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Allow photo library access to pick a photo.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const uri = await compressImage(asset.uri, asset.width, asset.height);
  return { uri, type: 'image' };
}

async function compressImage(uri: string, width: number, height: number): Promise<string> {
  let context = ImageManipulator.manipulate(uri);
  if (width > MAX_IMAGE_DIMENSION) {
    context = context.resize({ width: MAX_IMAGE_DIMENSION });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: IMAGE_COMPRESS_QUALITY, format: SaveFormat.JPEG });
  return saved.uri;
}

/**
 * Picks a video from the library (capped at 60s / medium quality) and generates
 * a thumbnail. Returns null if the user cancels. Throws if permission is denied
 * or the picked video exceeds the duration cap.
 */
export async function pickVideo(): Promise<PickedMedia | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Allow photo library access to pick a video.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    videoMaxDuration: MAX_VIDEO_DURATION_SECONDS,
    quality: ImagePicker.UIImagePickerControllerQualityType.Medium,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.duration && asset.duration > MAX_MEDIA_DURATION_MS) {
    throw new Error('Please pick a video under 60 seconds.');
  }

  let thumbnailUri: string | undefined;
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 });
    thumbnailUri = thumb.uri;
  } catch {
    // Thumbnail generation is best-effort — the video itself still uploads fine without one.
  }

  return { uri: asset.uri, type: 'video', thumbnailUri };
}

/**
 * Hook wrapping expo-audio recording with permissioning and a 60s auto-stop cap.
 */
export function useMediaRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(async (): Promise<PickedMedia | null> => {
    if (!isRecordingRef.current) return null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    isRecordingRef.current = false;
    setIsRecording(false);
    return recorder.uri ? { uri: recorder.uri, type: 'audio' } : null;
  }, [recorder]);

  const start = useCallback(async () => {
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) throw new Error('Allow microphone access to record audio.');
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    recorder.record();
    isRecordingRef.current = true;
    setIsRecording(true);
    timeoutRef.current = setTimeout(() => {
      stop();
    }, MAX_MEDIA_DURATION_MS);
  }, [recorder, stop]);

  return { isRecording, start, stop };
}

async function uploadToStorage(uri: string, path: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, { upsert: true, contentType: blob.type });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function extensionFor(uri: string, type: MediaType): string {
  if (type === 'audio') return 'm4a';
  const fromUri = uri.split('.').pop();
  return fromUri || (type === 'video' ? 'mp4' : 'jpg');
}

function randomId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads a profile/onboarding intro media file. Always overwrites the same
 * `{userId}/intro.{ext}` object — a profile has exactly one intro slot.
 */
export async function uploadIntroMedia(userId: string, media: PickedMedia): Promise<{ url: string }> {
  const ext = extensionFor(media.uri, media.type);
  const path = `${userId}/intro.${ext}`;
  const url = await uploadToStorage(media.uri, path);
  return { url };
}

/**
 * Uploads a feed post's media (and thumbnail, if any) to a unique per-post path,
 * since a user can have many posts unlike the single profile intro slot.
 */
export async function uploadPostMedia(
  userId: string,
  media: PickedMedia
): Promise<{ url: string; thumbnailUrl: string | null }> {
  const ext = extensionFor(media.uri, media.type);
  const id = randomId();
  const url = await uploadToStorage(media.uri, `${userId}/posts/${id}.${ext}`);

  let thumbnailUrl: string | null = null;
  if (media.thumbnailUri) {
    thumbnailUrl = await uploadToStorage(media.thumbnailUri, `${userId}/posts/${id}_thumb.jpg`);
  }
  return { url, thumbnailUrl };
}
