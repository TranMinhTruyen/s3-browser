import { ResourceLanguage } from 'i18next';
import common from '@/locales/ja/common.json';
import downloaderWindow from '@/locales/ja/components/downloaderWindow.json';
import inputs from '@/locales/ja/components/inputs.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import connectModal from '@/locales/ja/components/modals/connectModal.json';
import historyModal from '@/locales/ja/components/modals/historyModal.json';
import uploadLimitModal from '@/locales/ja/components/modals/uploadLimitModal.json';
import connectionProfiles from '@/locales/ja/components/navbar/connectionProfiles.json';
import objectDetailDrawer from '@/locales/ja/components/objectDetailDrawer.json';
import tabLayout from '@/locales/ja/components/tabLayout.json';
import uploaderWindow from '@/locales/ja/components/uploaderWindow.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';
import bucketPage from '@/locales/ja/pages/bucket/page.json';
import objectPage from '@/locales/ja/pages/object/page.json';

const japaneseResource: ResourceLanguage = {
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
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default japaneseResource;
