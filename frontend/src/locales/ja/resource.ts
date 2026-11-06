import { ResourceLanguage } from 'i18next';
import common from '@/locales/ja/common.json';
import bucketPicker from '@/locales/ja/components/inputs/bucketPicker.json';
import inputs from '@/locales/ja/components/inputs/inputs.json';
import appUpdate from '@/locales/ja/components/layouts/appUpdate.json';
import connectionProfiles from '@/locales/ja/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/ja/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/ja/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/ja/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/ja/components/modals/confirmModal.json';
import connectModal from '@/locales/ja/components/modals/connectModal.json';
import createBucketModal from '@/locales/ja/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/ja/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/ja/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/ja/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/ja/components/modals/deleteResultModal.json';
import historyModal from '@/locales/ja/components/modals/historyModal.json';
import settingModal from '@/locales/ja/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/ja/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/ja/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/ja/messages/ipcMessage.json';
import validateMessage from '@/locales/ja/messages/validateMessage.json';
import bucketPage from '@/locales/ja/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/ja/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/ja/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/ja/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/ja/pages/tab/tabLayout.json';

const japaneseResource: ResourceLanguage = {
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
export default japaneseResource;
