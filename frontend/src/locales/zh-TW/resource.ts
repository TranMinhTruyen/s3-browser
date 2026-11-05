import { ResourceLanguage } from 'i18next';
import common from '@/locales/zh-TW/common.json';
import bucketPicker from '@/locales/zh-TW/components/inputs/bucketPicker.json';
import inputs from '@/locales/zh-TW/components/inputs/inputs.json';
import connectionProfiles from '@/locales/zh-TW/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/zh-TW/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/zh-TW/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/zh-TW/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/zh-TW/components/modals/confirmModal.json';
import connectModal from '@/locales/zh-TW/components/modals/connectModal.json';
import createBucketModal from '@/locales/zh-TW/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/zh-TW/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/zh-TW/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/zh-TW/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/zh-TW/components/modals/deleteResultModal.json';
import historyModal from '@/locales/zh-TW/components/modals/historyModal.json';
import settingModal from '@/locales/zh-TW/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/zh-TW/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/zh-TW/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/zh-TW/messages/ipcMessage.json';
import validateMessage from '@/locales/zh-TW/messages/validateMessage.json';
import bucketPage from '@/locales/zh-TW/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/zh-TW/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/zh-TW/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/zh-TW/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/zh-TW/pages/tab/tabLayout.json';

const traditionalChineseResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  bucketPolicyModal: bucketPolicyModal,
  createBucketModal: createBucketModal,
  deleteBucketModal: deleteBucketModal,
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
  bucketDetailDrawer: bucketDetailDrawer,
  objectDetailDrawer: objectDetailDrawer,
  tabLayout: tabLayout,
  uploaderWindow: uploaderWindow,
};
export default traditionalChineseResource;
