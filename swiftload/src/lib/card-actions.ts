/** The action set handed to every download card. */

import type { CardActions } from "../components/download-card";
import {
  cancelDownload,
  changeLimit,
  copyUrlOf,
  openFileOf,
  openFolderOf,
  pauseDownload,
  removeDownload,
  resumeDownload,
  retryDownload,
  showDetails,
  startDownload,
} from "./actions";

export const cardActions: CardActions = {
  start: (record) => void startDownload(record),
  pause: (record) => void pauseDownload(record),
  resume: (record) => void resumeDownload(record),
  cancel: (record) => void cancelDownload(record),
  retry: (record) => void retryDownload(record),
  openFile: (record) => void openFileOf(record),
  openFolder: (record) => void openFolderOf(record),
  copyUrl: (record) => void copyUrlOf(record),
  remove: (record, deleteFile) => void removeDownload(record, deleteFile),
  changeLimit: (record) => changeLimit(record),
  showDetails: (record) => showDetails(record),
};
