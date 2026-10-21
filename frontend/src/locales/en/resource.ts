import { ResourceLanguage } from 'i18next';
import common from '@/locales/en/common.json';
import inputs from '@/locales/en/components/inputs.json';
import confirmModal from '@/locales/en/components/modals/confirmModal.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import historyModal from '@/locales/en/components/modals/historyModal.json';
import connectionProfiles from '@/locales/en/components/navbar/connectionProfiles.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';
import bucketPage from '@/locales/en/pages/bucket/page.json';

const englishResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  confirmModal: confirmModal,
  historyModal: historyModal,
  connectionProfiles: connectionProfiles,
  bucket: {
    page: bucketPage,
  },
  inputs: inputs,
};
export default englishResource;
