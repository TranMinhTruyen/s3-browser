import { ResourceLanguage } from 'i18next';
import common from '@/locales/ja/common.json';
import inputs from '@/locales/ja/components/inputs.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import connectModal from '@/locales/ja/components/modals/connectModal.json';
import historyModal from '@/locales/ja/components/modals/historyModal.json';
import connectionProfiles from '@/locales/ja/components/navbar/connectionProfiles.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';
import bucketPage from '@/locales/ja/pages/bucket/page.json';

const japaneseResource: ResourceLanguage = {
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
export default japaneseResource;
