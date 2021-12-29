/*
Copyright (C) 2021 Daniele Borgo
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

$(function () {
    function GPIOStatusViewModel(parameters) {
        let self = this;

        // assign the injected parameters, e.g.:
        // self.loginStateViewModel = parameters[0];
        // self.settingsViewModel = parameters[1];

        // TODO: Implement your plugin's view model here.

        self.updated_hour = ko.observable("-");
        self.set_hour = function () {
            let date = new Date($.now());
            self.updated_hour(date.toLocaleDateString() + " " + date.toLocaleTimeString());
        }

        self.compact_view = ko.observable(true);
        self.checkUpdated = function (){
            self.refresh();
            return true;
        }

        self.refresh = function () {
            self.set_text_all_output("Updating...");

            $.ajax({
                url: API_BASEURL + "plugin/gpiostatus",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify({
                    command: "gpio_status"
                })
            }).done(function (data) {
                console.log("GPIO status data arrived");
                self.parse_gpio_status(data.status);
                self.parse_services(data.services);
            }).fail(function () {
                console.log("Error");
                self.set_text_all_output("Failed to retrieve");
            }).always(function () {
                self.set_hour();
            });
        }

        self.gpio_table = ko.observable();
        self.funcs_table = ko.observable();
        self.parse_gpio_status = function (gpio_status) {
            let rows = gpio_status.rows;
            let columns = gpio_status.columns;
            let pins = gpio_status.pins;
            let compact_view = self.compact_view();

            if (columns !== 2 || rows % 2 === 1)
                throw "This is not possible: col=" + columns + " row=" + rows;

            self.prepare_header(compact_view);

            let raw_gpio_table = [];
            let raw_func_table = [];
            pins.forEach(function (pin) {
                raw_gpio_table.push(self.prepare_row(pin));

                if(pin.is_bcm)
                    raw_func_table.push(Array(pin.name).concat(pin.funcs))
            })
            raw_func_table.sort(function(pin1, pin2){
                return parseInt(pin1[0].substr(4)) < parseInt(pin2[0].substr(4))?-1:1;
            })

            if (compact_view) {
                let reformatted_table = [];
                for (let i = 0; i < raw_gpio_table.length; i += 2)
                    reformatted_table.push(raw_gpio_table[i].reverse().concat(raw_gpio_table[i + 1]));
                raw_gpio_table = reformatted_table;
            }

            self.gpio_table(self.put_in_html_table(raw_gpio_table))
            self.funcs_table(self.put_in_html_table(raw_func_table));
        }

        self.gpio_table_header = ko.observable();
        self.gpio_table_headers_list = ["Physical", "Name", "Function", "Pull", "Voltage"];
        self.gpio_table_headers_list_r = self.gpio_table_headers_list.slice().reverse();
        self.prepare_header = function (compact_view) {
            self.gpio_table_header("<tr>" + self.wrap_td(
                compact_view ?
                    self.gpio_table_headers_list_r.concat(self.gpio_table_headers_list) :
                    self.gpio_table_headers_list
            ) + "</tr>");
        }

        self.prepare_row = function (pin_status) {
            if (pin_status.is_bcm)
                return [
                    pin_status.physical_name,
                    pin_status.name,
                    self.parse_func(pin_status),
                    pin_status.pull,
                    pin_status.current_value
                ];
            return [pin_status.physical_name, pin_status.name, "", "", ""];
        }

        self.parse_func = function (pin_status){
            if(pin_status.current_func === "OUTPUT")
                return "OUT";
            if(pin_status.current_func === "INPUT")
                return "IN";
            return pin_status.funcs[pin_status.current_func];
        }

        self.put_in_html_table = function (array){
            let wrapped = [];
            array.forEach(function (row){
                wrapped.push(self.wrap_td(row))
            })
            return self.wrap_tr(wrapped);
        }

        self.wrap_td = function (array) {
            return self.wrap_with_tag(array, "td")
        }

        self.wrap_tr = function (array){
            return self.wrap_with_tag(array, "tr")
        }

        self.wrap_with_tag = function (array, tag){
            return "<" + tag + ">" + array.join("</" + tag + "><" + tag + ">") + "</" + tag + ">";
        }

        self.camera_status = ko.observable();
        self.ssh_status = ko.observable();
        self.spi_status = ko.observable();
        self.i2c_status = ko.observable();
        self.serial_status = ko.observable();
        self.serial_hw_status = ko.observable();
        self.one_wire_status = ko.observable();
        self.rgpio_status = ko.observable();
        self.parse_services = function (services_status){
            self.camera_status(self.service_status_to_str(services_status.camera));
            self.ssh_status(self.service_status_to_str(services_status.ssh));
            self.spi_status(self.service_status_to_str(services_status.spi));
            self.i2c_status(self.service_status_to_str(services_status.i2c));
            self.serial_status(self.service_status_to_str(services_status.serial));
            self.serial_hw_status(self.service_status_to_str(services_status.serial_hw));
            self.one_wire_status(self.service_status_to_str(services_status.one_wire));
            self.rgpio_status(self.service_status_to_str(services_status.remote_gpio));
        }

        self.service_status_to_str = function (status){
            return status? "enabled":"disabled";
        }

        self.set_text_all_output = function (text){
            self.updated_hour(text)
            self.gpio_table_header("<tr><td>"+ text +"</td></tr>")
            self.gpio_table("<tr><td>"+ text +"</td></tr>")
            self.funcs_table("<tr><td>"+ text +"</td></tr>")
            self.camera_status(text);
            self.ssh_status(text);
            self.spi_status(text);
            self.i2c_status(text);
            self.serial_status(text);
            self.serial_hw_status(text);
            self.one_wire_status(text);
            self.camera_status(text);
            self.rgpio_status(text);
        }

        self.onStartupComplete = function () {
            self.refresh()
        }
    }

    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: GPIOStatusViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: [],
        // Elements to bind to, e.g. #settings_plugin_gpiostatus, #tab_plugin_gpiostatus, ...
        elements: ["#settings_plugin_gpiostatus"]
    });
});
