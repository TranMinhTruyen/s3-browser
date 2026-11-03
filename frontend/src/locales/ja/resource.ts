import { ResourceLanguage } from 'i18next';
import common from '@/locales/ja/common.json';
import bucketPicker from '@/locales/ja/components/inputs/bucketPicker.json';
import inputs from '@/locales/ja/components/inputs/inputs.json';
import connectionProfiles from '@/locales/ja/components/layouts/navbar/connectionProfiles.json';
import objectDetailDrawer from '@/locales/ja/components/layouts/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/ja/components/layouts/tab/tabLayout.json';
import downloaderWindow from '@/locales/ja/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/ja/components/layouts/transfer/uploaderWindow.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import connectModal from '@/locales/ja/components/modals/connectModal.json';
import credentialExpiring from '@/locales/ja/components/modals/credentialExpiring.json';
import deleteConfirmModal from '@/locales/ja/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/ja/components/modals/deleteResultModal.json';
import historyModal from '@/locales/ja/components/modals/historyModal.json';
import settingModal from '@/locales/ja/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/ja/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/ja/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';
import bucketPage from '@/locales/ja/pages/bucket/page.json';
import objectPage from '@/locales/ja/pages/object/page.json';

const japaneseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  deleteConfirmModal: deleteConfirmModal,
  deleteResultModal: deleteResultModal,
  historyModal: historyModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  bucketPicker: bucketPicker,
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
