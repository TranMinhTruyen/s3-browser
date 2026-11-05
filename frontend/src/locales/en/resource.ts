import { ResourceLanguage } from 'i18next';
import common from '@/locales/en/common.json';
import bucketPicker from '@/locales/en/components/inputs/bucketPicker.json';
import inputs from '@/locales/en/components/inputs/inputs.json';
import connectionProfiles from '@/locales/en/components/layouts/navbar/connectionProfiles.json';
import downloaderWindow from '@/locales/en/components/layouts/transfer/downloaderWindow.json';
import uploaderWindow from '@/locales/en/components/layouts/transfer/uploaderWindow.json';
import bucketPolicyModal from '@/locales/en/components/modals/bucketPolicyModal.json';
import confirmModal from '@/locales/en/components/modals/confirmModal.json';
import connectModal from '@/locales/en/components/modals/connectModal.json';
import createBucketModal from '@/locales/en/components/modals/createBucketModal.json';
import credentialExpiring from '@/locales/en/components/modals/credentialExpiring.json';
import deleteConfirmModal from '@/locales/en/components/modals/deleteConfirmModal.json';
import deleteResultModal from '@/locales/en/components/modals/deleteResultModal.json';
import historyModal from '@/locales/en/components/modals/historyModal.json';
import settingModal from '@/locales/en/components/modals/settingModal.json';
import uploadLimitModal from '@/locales/en/components/modals/uploadLimitModal.json';
import uploadPickerModal from '@/locales/en/components/modals/uploadPickerModal.json';
import ipcMessage from '@/locales/en/messages/ipcMessage.json';
import validateMessage from '@/locales/en/messages/validateMessage.json';
import bucketPage from '@/locales/en/pages/tab/bucket/page.json';
import bucketDetailDrawer from '@/locales/en/pages/tab/bucketDetailDrawer.json';
import objectPage from '@/locales/en/pages/tab/object/page.json';
import objectDetailDrawer from '@/locales/en/pages/tab/objectDetailDrawer.json';
import tabLayout from '@/locales/en/pages/tab/tabLayout.json';

const englishResource: ResourceLanguage = {
  common: common,
  ipcMessage: ipcMessage,
  validateMessage: validateMessage,
  connectModal: connectModal,
  credentialExpiring: credentialExpiring,
  confirmModal: confirmModal,
  bucketPolicyModal: bucketPolicyModal,
  createBucketModal: createBucketModal,
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
export default englishResource;
