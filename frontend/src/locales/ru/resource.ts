import { ResourceLanguage } from 'i18next';
import common from '@/locales/ru/common.json';
import bucketPicker from '@/locales/ru/components/inputs/bucketPicker.json';
import inputs from '@/locales/ru/components/inputs/inputs.json';
import connectionProfiles from '@/locales/ru/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/ru/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/ru/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/ru/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/ru/components/modals/confirmModal.json';
import connectModal from '@/locales/ru/components/modals/connectModal.json';
import createBucketModal from '@/locales/ru/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/ru/components/modals/credentialExpiring.json';
import deleteBucketModal from '@/locales/ru/components/modals/deleteBucketModal.json';
import deleteConfirmModal from '@/locales/ru/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/ru/components/modals/deleteResultModal.json';
import historyModal from '@/locales/ru/components/modals/historyModal.json';
import settingModal from '@/locales/ru/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/ru/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/ru/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/ru/messages/ipcMessage.json';
import validateMessage from '@/locales/ru/messages/validateMessage.json';
import bucketPage from '@/locales/ru/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/ru/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/ru/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/ru/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/ru/pages/tab/tabLayout.json';

const russianResource: ResourceLanguage = {
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
export default russianResource;
