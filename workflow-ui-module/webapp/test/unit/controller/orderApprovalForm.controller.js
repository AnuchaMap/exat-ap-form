/*apobal QUnit*/

sap.ui.define([
	"apmgtnsp/workflow-ui-module/controller/apApprovalForm.controller"
], function (Controller) {
	"use strict";

	QUnit.module("apApprovalForm Controller");

	QUnit.test("I should test the apApprovalForm controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
