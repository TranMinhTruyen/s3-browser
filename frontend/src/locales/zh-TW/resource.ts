import { ResourceLanguage } from 'i18next';
import common from '@/locales/zh-TW/common.json';
import bucketPicker from '@/locales/zh-TW/components/inputs/bucketPicker.json';
import inputs from '@/locales/zh-TW/components/inputs/inputs.json';
import connectionProfiles from '@/locales/zh-TW/components/layouts/navbar/connectionProfiles.json';
import objectDetailDrawer from '@/locales/zh-TW/components/layouts/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/zh-TW/components/layouts/tab/tabLayout.json';
import downloaderWindow from '@/locales/zh-TW/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/zh-TW/components/layouts/transfer/uploaderWindow.json';
import confirmModal from '@/locales/zh-TW/components/modals/confirmModal.json';
import connectModal from '@/locales/zh-TW/components/modals/connectModal.json';
import credentialExpiring from '@/locales/zh-TW/components/modals/credentialExpiring.json';
import deleteConfirmModal from '@/locales/zh-TW/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/zh-TW/components/modals/deleteResultModal.json';
import historyModal from '@/locales/zh-TW/components/modals/historyModal.json';
import settingModal from '@/locales/zh-TW/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/zh-TW/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/zh-TW/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/zh-TW/messages/ipcMessage.json';
import validateMessage from '@/locales/zh-TW/messages/validateMessage.json';
import bucketPage from '@/locales/zh-TW/pages/bucket/page.json';
import objectPage from '@/locales/zh-TW/pages/object/page.json';

const traditionalChineseResource: ResourceLanguage = {
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
export default traditionalChineseResource;
