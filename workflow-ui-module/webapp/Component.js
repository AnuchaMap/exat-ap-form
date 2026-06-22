sap.ui.define(
  [
    "sap/ui/core/UIComponent",
    "sap/ui/Device",
    "apmgtnsp/workflowuimodule/model/models",
    "sap/m/MessageBox",
  ],
  function (UIComponent, Device, models, MessageBox) {
    "use strict";

    return UIComponent.extend("apmgtnsp.workflowuimodule.Component", {
      metadata: {
        manifest: "json",
      },

      init: function () {
        UIComponent.prototype.init.apply(this, arguments);
        this.getRouter().initialize();
        this.setModel(models.createDeviceModel(), "device");
        this.setTaskModels();

        var oContextModel = this.getModel("context");

        oContextModel.attachRequestCompleted(
          function () {
            // ✅ เปลี่ยนจาก RequestStatus มาใช้ IsAllApproved / IsReject
            var bIsAllApproved = oContextModel.getProperty("/IsAllApproved");
            var bIsReject      = oContextModel.getProperty("/IsReject");
            var bIsPending     = !bIsAllApproved && !bIsReject;

            if (bIsPending) {
              // ยังรออนุมัติ → แสดงปุ่ม Approve + Reject
              this.getInboxAPI().addAction(
                { action: "reject", label: "Reject", type: "reject" },
                function () { this.completeTask(false, "reject"); },
                this,
              );
              this.getInboxAPI().addAction(
                { action: "approve", label: "Approve", type: "accept" },
                function () { this.completeTask(true, "approve"); },
                this,
              );
            } else {
              // ผ่านกระบวนการแล้ว → แสดงแค่ปุ่ม Close
              this.getInboxAPI().addAction(
                { action: "approve", label: "Close", type: "reject" },
                function () { this.completeTask(true, "approve"); },
                this,
              );
            }
          }.bind(this),
        );
      },

      setTaskModels: function () {
        var startupParameters = this.getComponentData().startupParameters;
        this.setModel(startupParameters.taskModel, "task");

        var taskContextModel = new sap.ui.model.json.JSONModel(
          this._getTaskInstancesBaseURL() + "/context",
        );
        this.setModel(taskContextModel, "context");
      },

      _getTaskInstancesBaseURL: function () {
        return (
          this._getWorkflowRuntimeBaseURL() +
          "/task-instances/" +
          this.getTaskInstanceID()
        );
      },

      _getWorkflowRuntimeBaseURL: function () {
        var ui5CloudService = this.getManifestEntry("/sap.cloud/service").replaceAll(".", "");
        var ui5ApplicationName = this.getManifestEntry("/sap.app/id").replaceAll(".", "");
        return "/" + ui5CloudService + "." + ui5ApplicationName + "/api/public/workflow/rest/v1";
      },

      getTaskInstanceID: function () {
        return this.getModel("task").getData().InstanceID;
      },

      getInboxAPI: function () {
        return this.getComponentData().startupParameters.inboxAPI;
      },

      completeTask: function (approvalStatus, outcomeId) {
        this.getModel("context").setProperty("/approved", approvalStatus);
        this._patchTaskInstance(outcomeId);
      },

      _patchTaskInstance: function (outcomeId) {
        const context = this.getModel("context").getData();

        // ✅ เปลี่ยนจาก RequestStatus มาใช้ IsAllApproved / IsReject
        var bIsAllApproved = context.IsAllApproved;
        var bIsReject      = context.IsReject;
        var bIsPending     = !bIsAllApproved && !bIsReject;

        if (!bIsPending) {
          context.ApproverComment    = context.ApproverComment    || "";
          context.SignatureUsername  = context.SignatureUsername  || "";
          context.SignaturePassword  = context.SignaturePassword  || "";
          context.SignatureToken     = context.SignatureToken     || "";
          context.IsClose            = true;
        } else {
          context.IsClose = false;
        }

        jQuery.ajax({
          url: this._getTaskInstancesBaseURL(),
          method: "PATCH",
          contentType: "application/json",
          async: true,
          data: JSON.stringify({
            status: "COMPLETED",
            context: { ...context, comment: context.comment || "" },
            decision: outcomeId,
          }),
          headers: { "X-CSRF-Token": this._fetchToken() },
        }).done(() => {
          this._refreshTaskList();
        });
      },

      _fetchToken: function () {
        var fetchedToken;
        jQuery.ajax({
          url: this._getWorkflowRuntimeBaseURL() + "/xsrf-token",
          method: "GET",
          async: false,
          headers: { "X-CSRF-Token": "Fetch" },
          success: function (result, xhr, data) {
            fetchedToken = data.getResponseHeader("X-CSRF-Token");
          },
        });
        return fetchedToken;
      },

      _refreshTaskList: function () {
        this.getInboxAPI().updateTask("NA", this.getTaskInstanceID());
      },
    });
  },
);