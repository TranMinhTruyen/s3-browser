import { ResourceLanguage } from 'i18next';
import common from '@/locales/vi/common.json';
import inputs from '@/locales/vi/components/inputs.json';
import confirmModal from '@/locales/vi/components/modals/confirmModal.json';
import connectModal from '@/locales/vi/components/modals/connectModal.json';
import historyModal from '@/locales/vi/components/modals/historyModal.json';
import uploadLimitModal from '@/locales/vi/components/modals/uploadLimitModal.json';
import connectionProfiles from '@/locales/vi/components/navbar/connectionProfiles.json';
import uploaderWindow from '@/locales/vi/components/uploaderWindow.json';
import ipcMessage from '@/locales/vi/messages/ipcMessage.json';
import validateMessage from '@/locales/vi/messages/validateMessage.json';
import bucketPage from '@/locales/vi/pages/bucket/page.json';

const vietnameseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  confirmModal: confirmModal,
  historyModal: historyModal,
  uploadLimitModal: uploadLimitModal,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  inputs: inputs,
  uploaderWindow: uploaderWindow,
};
export default vietnameseResource;
