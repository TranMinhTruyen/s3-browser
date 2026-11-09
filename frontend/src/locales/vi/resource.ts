import { ResourceLanguage } from 'i18next';
import common from '@/locales/vi/common.json';
import bucketPicker from '@/locales/vi/components/inputs/bucketPicker.json';
import inputs from '@/locales/vi/components/inputs/inputs.json';
import appUpdate from '@/locales/vi/components/layouts/appUpdate.json';
import connectionProfiles from '@/locales/vi/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/vi/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/vi/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/vi/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/vi/components/modals/confirmModal.json';
import connectModal from '@/locales/vi/components/modals/connectModal.json';
import createBucketModal from '@/locales/vi/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/vi/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/vi/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/vi/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/vi/components/modals/deleteResultModal.json';
import exportProfileModal from '@/locales/vi/components/modals/exportProfileModal.json';
import historyModal from '@/locales/vi/components/modals/historyModal.json';
import importPasswordModal from '@/locales/vi/components/modals/importPasswordModal.json';
import settingModal from '@/locales/vi/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/vi/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/vi/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/vi/messages/ipcMessage.json';
import validateMessage from '@/locales/vi/messages/validateMessage.json';
import bucketPage from '@/locales/vi/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/vi/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/vi/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/vi/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/vi/pages/tab/tabLayout.json';

const vietnameseResource: ResourceLanguage = {
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
  exportProfileModal: exportProfileModal,
  historyModal: historyModal,
  importPasswordModal: importPasswordModal,
  settingModal: settingModal,
  uploadLimitModal: uploadLimitModal,
  uploadPickerModal: uploadPickerModal,
  appUpdate: appUpdate,
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
export default vietnameseResource;
