import { ResourceLanguage } from 'i18next';
import common from '@/locales/en/common.json';
import downloaderWindow from '@/locales/en/components/downloaderWindow.json';
import inputs from '@/locales/en/components/inputs.json';
import confirmModal from '@/locales/en/components/modals/confirmModal.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import historyModal from '@/locales/en/components/modals/historyModal.json';
import uploadLimitModal from '@/locales/en/components/modals/uploadLimitModal.json';
import connectionProfiles from '@/locales/en/components/navbar/connectionProfiles.json';
import tabLayout from '@/locales/en/components/tabLayout.json';
import uploaderWindow from '@/locales/en/components/uploaderWindow.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';
import bucketPage from '@/locales/en/pages/bucket/page.json';
import objectPage from '@/locales/en/pages/object/page.json';

const englishResource: ResourceLanguage = {
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
  object: {
    page: objectPage,
  },
  inputs: inputs,
  downloaderWindow: downloaderWindow,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default englishResource;
